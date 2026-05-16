/**
 * E2E tests for the bid worker processor.
 *
 * Strategy: mock the BullMQ Worker class to capture the processor function,
 * then invoke it directly with a fake Job object.  This lets us exercise the
 * full worker logic (mode routing, socket emissions, lock acquire/release,
 * error handling) against a real MongoMemoryServer — without needing an
 * actual Redis instance (ioredis-mock does not support the ZMPOP command
 * that BullMQ v5 requires).
 */

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

jest.mock('bullmq', () => {
  // Keep the real UnrecoverableError so `instanceof` checks work in tests.
  const { UnrecoverableError } = jest.requireActual('bullmq');
  return {
    Worker: jest.fn(),
    UnrecoverableError,
  };
});

// Prevent bid-queue.ts from instantiating a real BullMQ Queue on import.
jest.mock('../../src/queues/bid-queue', () => ({
  BID_QUEUE_NAME: 'bid',
}));

// Replace real IORedis connections with plain stubs — Worker is mocked so
// the connection object is never actually used.
jest.mock('../../src/shared/redis', () => ({ redisConnection: {} }));

jest.mock('../../src/shared/bid-lock', () => ({
  acquireBidLock: jest.fn(),
  releaseBidLock: jest.fn(),
  acquireBidLockWithWait: jest.fn(),
}));

jest.mock('../../src/services/bid-service', () => ({
  __esModule: true,
  default: {
    createOpenBid: jest.fn(),
    createLivestreamBid: jest.fn(),
    createSealedBid: jest.fn(),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Worker, UnrecoverableError } from 'bullmq';
import { Types } from 'mongoose';
import { acquireBidLock, releaseBidLock, acquireBidLockWithWait } from '../../src/shared/bid-lock';
import bidService from '../../src/services/bid-service';
import { startBidWorker } from '../../src/workers/bid-worker';
import { Item } from '../../src/models/item-model';
import { Bidder } from '../../src/models/user-model';
import { ESocketEventCode } from '../../src/globals';
import { ForbiddenError } from '../../src/shared/errors';
import { connectTestDb, disconnectTestDb, clearTestDb } from '../helpers/db';
import { buildBidder } from '../helpers/factories/user.factory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Captured worker processor — populated by the Worker mock in beforeEach. */
let runJob: (job: any) => Promise<any>;

/** Captured worker event handlers — keyed by event name. */
let workerHandlers: Record<string, Function>;

/** Per-test Socket.IO emission tracker. */
let emittedEvents: { room: string; event: string; args: any[] }[];
let mockIo: any;

/** Seeded document IDs — reset in beforeEach. */
let itemId: Types.ObjectId;
let auctionId: Types.ObjectId;
let bidderId: Types.ObjectId;

const SOCKET_ID = 'socket-test-abc';

function buildMockIo() {
  emittedEvents = [];
  return {
    to: jest.fn((room: string) => ({
      emit: jest.fn((event: string, ...args: any[]) => {
        emittedEvents.push({ room, event, args });
      }),
    })),
  };
}

/** Build a minimal stub bid returned by the mocked bidService. */
function stubBid(overrides: Record<string, any> = {}) {
  const _id = new Types.ObjectId();
  const bid = {
    _id,
    id: _id,                // Mongoose `id` virtual — toString() gives hex string
    itemId,
    bidAmount: 1000,
    ...overrides,
  };
  return { ...bid, toJSON: () => bid };
}

/** Build a fake BullMQ Job with sensible defaults. */
function makeJob(
  dataOverrides: { socketId?: string; bidderId?: string; input?: Partial<{ itemId: string; bidAmount: number }> } = {},
) {
  return {
    id: 'job-e2e-1',
    data: {
      socketId: SOCKET_ID,
      bidderId: bidderId.toHexString(),
      input: { itemId: itemId.toHexString(), bidAmount: 1000 },
      ...dataOverrides,
    },
    opts: { attempts: 3 },
    attemptsMade: 1,
  };
}

/** Insert a minimal Item document directly (bypasses schema validation). */
async function seedItem(opts: { isClosedBidding?: boolean; isBidIncrementedManually?: boolean } = {}) {
  await Item.collection.insertOne({
    _id: itemId,
    auctionId,
    title: { en: 'Test Item', tn: 'Test Item' },
    isClosedBidding: opts.isClosedBidding ?? false,
    isBidIncrementedManually: opts.isBidIncrementedManually ?? false,
    startingBid: 500,
    bidIncrement: 100,
    reservePrice: 0,
  } as any);
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(() => connectTestDb());
afterAll(() => disconnectTestDb());

beforeEach(async () => {
  jest.clearAllMocks();

  // Rebuild mock IO + reset emission log.
  mockIo = buildMockIo();

  // Capture the worker processor and event handlers from the Worker constructor.
  workerHandlers = {};
  (Worker as unknown as jest.Mock).mockImplementation((_name: string, processor: Function) => {
    runJob = processor as (job: any) => Promise<any>;
    return {
      on: jest.fn((event: string, handler: Function) => {
        workerHandlers[event] = handler;
      }),
    };
  });

  // Default: lock always available, always released cleanly.
  (acquireBidLock as jest.Mock).mockResolvedValue(true);
  (releaseBidLock as jest.Mock).mockResolvedValue(undefined);
  (acquireBidLockWithWait as jest.Mock).mockResolvedValue(true);

  // Starting the worker registers the processor.
  startBidWorker(mockIo);

  // Fresh DB state + new IDs for every test.
  await clearTestDb();
  itemId = new Types.ObjectId();
  auctionId = new Types.ObjectId();
  bidderId = new Types.ObjectId();

  // Seed a bidder that Bidder.findById() will find.
  await Bidder.collection.insertOne({
    ...buildBidder(),
    _id: bidderId,
    __t: 'Bidder',
  } as any);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bid-worker', () => {
  // ─── Mode routing ─────────────────────────────────────────────────────────

  describe('Mode 1 — open bid (isClosedBidding=false, isBidIncrementedManually=false)', () => {
    it('calls createOpenBid, emits UPDATE_BID_AMOUNT to room and BID_RESULT accepted to bidder', async () => {
      await seedItem({ isClosedBidding: false, isBidIncrementedManually: false });
      const bid = stubBid();
      (bidService.createOpenBid as jest.Mock).mockResolvedValue(bid);

      const result = await runJob(makeJob());

      // Correct service called
      expect(bidService.createOpenBid).toHaveBeenCalledTimes(1);
      expect(bidService.createLivestreamBid).not.toHaveBeenCalled();
      expect(bidService.createSealedBid).not.toHaveBeenCalled();

      // UPDATE_BID_AMOUNT → item bid room
      const roomEmit = emittedEvents.find(
        (e) => e.room === `${itemId.toHexString()}-bid` && e.event === ESocketEventCode.UPDATE_BID_AMOUNT,
      );
      expect(roomEmit).toBeDefined();
      expect(roomEmit!.args[0]).toMatchObject({ newPrice: bid.bidAmount });

      // BID_RESULT → bidder socket room
      const socketEmit = emittedEvents.find(
        (e) => e.room === SOCKET_ID && e.event === ESocketEventCode.BID_RESULT,
      );
      expect(socketEmit).toBeDefined();
      expect(socketEmit!.args[0]).toMatchObject({ status: 'accepted', bidId: bid.id.toString() });

      // Returned job result
      expect(result).toMatchObject({ bidId: bid.id.toString(), mode: 'open' });
    });
  });

  describe('Mode 2 — livestream bid (isBidIncrementedManually=true)', () => {
    it('calls createLivestreamBid, emits UPDATE_BID_AMOUNT and BID_RESULT accepted', async () => {
      await seedItem({ isClosedBidding: false, isBidIncrementedManually: true });
      const bid = stubBid({ bidAmount: 2000 });
      (bidService.createLivestreamBid as jest.Mock).mockResolvedValue(bid);

      const result = await runJob(makeJob({ input: { itemId: itemId.toHexString(), bidAmount: 2000 } }));

      expect(bidService.createLivestreamBid).toHaveBeenCalledTimes(1);
      expect(bidService.createOpenBid).not.toHaveBeenCalled();
      expect(bidService.createSealedBid).not.toHaveBeenCalled();

      const roomEmit = emittedEvents.find(
        (e) => e.room === `${itemId.toHexString()}-bid` && e.event === ESocketEventCode.UPDATE_BID_AMOUNT,
      );
      expect(roomEmit).toBeDefined();
      expect(roomEmit!.args[0]).toMatchObject({ newPrice: 2000 });

      expect(result).toMatchObject({ mode: 'livestream' });
    });
  });

  describe('Mode 3 — sealed bid (isClosedBidding=true)', () => {
    it('calls createSealedBid, emits SEALED_BID_ACCEPTED to room (no amount revealed)', async () => {
      await seedItem({ isClosedBidding: true });
      const bid = stubBid();
      (bidService.createSealedBid as jest.Mock).mockResolvedValue(bid);

      const result = await runJob(makeJob());

      expect(bidService.createSealedBid).toHaveBeenCalledTimes(1);
      expect(bidService.createOpenBid).not.toHaveBeenCalled();
      expect(bidService.createLivestreamBid).not.toHaveBeenCalled();

      // SEALED_BID_ACCEPTED has no payload (no bid amount leaked)
      const sealedEmit = emittedEvents.find(
        (e) => e.room === `${itemId.toHexString()}-bid` && e.event === ESocketEventCode.SEALED_BID_ACCEPTED,
      );
      expect(sealedEmit).toBeDefined();
      expect(sealedEmit!.args).toHaveLength(0); // no args

      // Must NOT emit UPDATE_BID_AMOUNT for sealed mode
      const amountEmit = emittedEvents.find((e) => e.event === ESocketEventCode.UPDATE_BID_AMOUNT);
      expect(amountEmit).toBeUndefined();

      expect(result).toMatchObject({ mode: 'sealed' });
    });
  });

  // ─── Bid lock ─────────────────────────────────────────────────────────────

  describe('bid lock', () => {
    it('succeeds when acquireBidLockWithWait returns true', async () => {
      await seedItem();
      (bidService.createOpenBid as jest.Mock).mockResolvedValue(stubBid());
      (acquireBidLockWithWait as jest.Mock).mockResolvedValue(true);

      const result = await runJob(makeJob());

      expect(result).toMatchObject({ mode: 'open' });
      expect(bidService.createOpenBid).toHaveBeenCalledTimes(1);
    });

    it('throws a plain Error (BullMQ retry) when acquireBidLockWithWait returns false', async () => {
      await seedItem();
      (acquireBidLockWithWait as jest.Mock).mockResolvedValue(false);

      await expect(runJob(makeJob())).rejects.toThrow('unavailable after extended wait');

      // No BID_RESULT emitted from the processor — client waits for the failed handler
      expect(emittedEvents.filter((e) => e.event === ESocketEventCode.BID_RESULT)).toHaveLength(0);
    });

    it('releases the lock in finally on success', async () => {
      await seedItem();
      (bidService.createOpenBid as jest.Mock).mockResolvedValue(stubBid());

      await runJob(makeJob());

      expect(releaseBidLock).toHaveBeenCalledWith(itemId.toHexString(), 'job-e2e-1');
    });

    it('releases the lock in finally even when a ForbiddenError is thrown', async () => {
      await seedItem();
      (bidService.createOpenBid as jest.Mock).mockRejectedValue(
        new ForbiddenError('Not eligible to bid'),
      );

      await expect(runJob(makeJob())).rejects.toThrow();

      expect(releaseBidLock).toHaveBeenCalledWith(itemId.toHexString(), 'job-e2e-1');
    });
  });

  // ─── worker.on('failed') — bidder notification ────────────────────────────

  describe('failed handler', () => {
    it('emits BID_RESULT rejected to bidder when all BullMQ attempts are exhausted (non-UnrecoverableError)', () => {
      startBidWorker(mockIo); // ensure handlers are registered
      const transientErr = new Error('MongoNetworkError: connection timed out');
      const job = makeJob();

      workerHandlers['failed'](job, transientErr);

      const socketEmit = emittedEvents.find(
        (e) => e.room === SOCKET_ID && e.event === ESocketEventCode.BID_RESULT,
      );
      expect(socketEmit).toBeDefined();
      expect(socketEmit!.args[0]).toMatchObject({
        status: 'rejected',
        error: expect.stringContaining('high demand'),
      });
    });

    it('does NOT emit BID_RESULT for UnrecoverableError (bidder already notified inside processor)', () => {
      startBidWorker(mockIo);
      const unrecoverable = new UnrecoverableError('Not eligible to bid on this item');
      const job = makeJob();

      workerHandlers['failed'](job, unrecoverable);

      expect(emittedEvents.filter((e) => e.event === ESocketEventCode.BID_RESULT)).toHaveLength(0);
    });
  });

  // ─── Business logic errors → UnrecoverableError ───────────────────────────

  describe('ForbiddenError from bidService', () => {
    it('emits BID_RESULT rejected and throws UnrecoverableError (no retry)', async () => {
      await seedItem();
      (bidService.createOpenBid as jest.Mock).mockRejectedValue(
        new ForbiddenError('Not eligible to bid on this item'),
      );

      await expect(runJob(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

      const socketEmit = emittedEvents.find(
        (e) => e.room === SOCKET_ID && e.event === ESocketEventCode.BID_RESULT,
      );
      expect(socketEmit).toBeDefined();
      expect(socketEmit!.args[0]).toMatchObject({
        status: 'rejected',
        error: 'Not eligible to bid on this item',
      });
    });
  });

  describe('NotFoundError — bidder does not exist in DB', () => {
    it('emits BID_RESULT rejected and throws UnrecoverableError', async () => {
      await seedItem();
      const missingBidderId = new Types.ObjectId().toHexString();

      await expect(
        runJob(makeJob({ bidderId: missingBidderId })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      const socketEmit = emittedEvents.find(
        (e) => e.room === SOCKET_ID && e.event === ESocketEventCode.BID_RESULT,
      );
      expect(socketEmit).toBeDefined();
      expect(socketEmit!.args[0]).toMatchObject({ status: 'rejected' });
    });
  });

  describe('NotFoundError — item does not exist in DB', () => {
    it('emits BID_RESULT rejected and throws UnrecoverableError', async () => {
      // No item seeded — worker throws NotFoundError('Item not found')
      await expect(runJob(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

      const socketEmit = emittedEvents.find(
        (e) => e.room === SOCKET_ID && e.event === ESocketEventCode.BID_RESULT,
      );
      expect(socketEmit).toBeDefined();
      expect(socketEmit!.args[0]).toMatchObject({ status: 'rejected' });
    });
  });

  // ─── Transient errors → retry ─────────────────────────────────────────────

  describe('transient error (non-business-logic)', () => {
    it('rethrows the error without emitting BID_RESULT so BullMQ can retry', async () => {
      await seedItem();
      const networkErr = new Error('MongoNetworkError: connection timed out');
      (bidService.createOpenBid as jest.Mock).mockRejectedValue(networkErr);

      await expect(runJob(makeJob())).rejects.toBe(networkErr);

      // No BID_RESULT — client shows "pending" until a retry succeeds
      expect(emittedEvents.filter((e) => e.event === ESocketEventCode.BID_RESULT)).toHaveLength(0);
    });
  });
});
