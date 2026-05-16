/**
 * E2E tests for the close-lot worker processor.
 *
 * Strategy mirrors bid-worker.spec.ts: mock BullMQ Worker to capture the
 * processor function, then invoke it directly with a fake Job object.
 * Item reads/writes run against a real MongoMemoryServer.
 */

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

jest.mock('bullmq', () => {
  return { Worker: jest.fn() };
});

jest.mock('../../src/queues/close-lot-queue', () => ({
  CLOSE_LOT_QUEUE_NAME: 'close-lot',
}));

jest.mock('../../src/shared/redis', () => ({ redisConnection: {} }));

jest.mock('../../src/services/item-service', () => ({
  __esModule: true,
  default: {
    autoSelectWinner: jest.fn(),
  },
}));

jest.mock('../../src/services/bid-service', () => ({
  __esModule: true,
  default: {
    decryptSealedBids: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/shared/socket-emitter', () => {
  const emittedEvents: { room: string; event: string; args: any[] }[] = [];
  const mockEmitter = {
    to: (room: string) => ({
      emit: (event: string, ...args: any[]) => {
        emittedEvents.push({ room, event, args });
      },
    }),
    _emittedEvents: emittedEvents,
    _reset: () => { emittedEvents.length = 0; },
  };
  return { socketEmitter: mockEmitter };
});

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Worker } from 'bullmq';
import { Types } from 'mongoose';
import { Item } from '../../src/models/item-model';
import { EItemStatus, ESocketEventCode } from '../../src/globals';
import itemService from '../../src/services/item-service';
import bidService from '../../src/services/bid-service';
import { socketEmitter } from '../../src/shared/socket-emitter';
import { startCloseLotWorker } from '../../src/workers/close-lot-worker';
import { connectTestDb, disconnectTestDb, clearTestDb } from '../helpers/db';
import { buildItem } from '../helpers/factories/item.factory';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Processor = (job: { data: { itemId: string } }) => Promise<void>;

let runJob: Processor;

function emittedEvents() {
  return (socketEmitter as any)._emittedEvents as { room: string; event: string; args: any[] }[];
}

async function seedItem(overrides: Record<string, unknown> = {}) {
  const data = {
    ...buildItem(),
    metadata: { isLivestock: false },
    ...overrides,
  };
  await Item.collection.insertOne(data as any);
  return (await Item.findById(data._id))!;
}

function makeJob(itemId: string) {
  return { data: { itemId } };
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

beforeEach(() => {
  jest.clearAllMocks();
  (socketEmitter as any)._reset();

  // Capture processor from Worker constructor call.
  (Worker as jest.Mock).mockImplementation((_, processor) => {
    runJob = processor;
    return { on: jest.fn(), close: jest.fn() };
  });

  startCloseLotWorker();
});

afterEach(clearTestDb);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('close-lot-worker', () => {
  describe('item not found', () => {
    it('exits cleanly without throwing', async () => {
      const missingId = new Types.ObjectId().toString();
      await expect(runJob(makeJob(missingId))).resolves.toBeUndefined();
    });
  });

  describe('item already ENDED', () => {
    it('exits without updating the item or selecting a winner', async () => {
      const item = await seedItem({ status: EItemStatus.ENDED });

      await runJob(makeJob(item._id.toString()));

      expect(itemService.autoSelectWinner).not.toHaveBeenCalled();
      const unchanged = await Item.findById(item._id);
      expect(unchanged!.status).toBe(EItemStatus.ENDED);
    });
  });

  describe('open-bid lot', () => {
    it('sets status to ENDED and calls autoSelectWinner', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE, isClosedBidding: false });
      const winnerId = new Types.ObjectId();
      (itemService.autoSelectWinner as jest.Mock).mockResolvedValueOnce({
        _id: item._id,
        winningBidder: winnerId,
      });

      await runJob(makeJob(item._id.toString()));

      const updated = await Item.findById(item._id);
      expect(updated!.status).toBe(EItemStatus.ENDED);
      expect(itemService.autoSelectWinner).toHaveBeenCalledWith(item._id.toString());
    });

    it('emits BROADCAST_REFRESH_AFTER_WINNING to the bidding room', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE, isClosedBidding: false });
      const winnerId = new Types.ObjectId();
      (itemService.autoSelectWinner as jest.Mock).mockResolvedValueOnce({
        _id: item._id,
        winningBidder: winnerId,
      });

      await runJob(makeJob(item._id.toString()));

      const broadcast = emittedEvents().find(
        (e) => e.event === ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING,
      );
      expect(broadcast).toBeDefined();
      expect(broadcast!.room).toBe(`${item._id.toString()}-bid`);
      expect(broadcast!.args[0]).toBe(item._id.toString());
    });

    it('does NOT emit BROADCAST_REFRESH_AFTER_WINNING when lot goes unsold', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE, isClosedBidding: false });
      // autoSelectWinner returns item with no winningBidder (reserve not met / no bids)
      (itemService.autoSelectWinner as jest.Mock).mockResolvedValueOnce({
        _id: item._id,
        winningBidder: null,
      });

      await runJob(makeJob(item._id.toString()));

      const broadcast = emittedEvents().find(
        (e) => e.event === ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING,
      );
      expect(broadcast).toBeUndefined();
    });
  });

  describe('sealed-bid lot', () => {
    it('decrypts sealed bids before calling autoSelectWinner', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE, isClosedBidding: true });
      const winnerId = new Types.ObjectId();
      (itemService.autoSelectWinner as jest.Mock).mockResolvedValueOnce({
        _id: item._id,
        winningBidder: winnerId,
      });

      await runJob(makeJob(item._id.toString()));

      // decryptSealedBids must be called before autoSelectWinner
      const decryptOrder = (bidService.decryptSealedBids as jest.Mock).mock.invocationCallOrder[0];
      const winnerOrder = (itemService.autoSelectWinner as jest.Mock).mock.invocationCallOrder[0];
      expect(decryptOrder).toBeLessThan(winnerOrder);
    });

    it('does NOT call decryptSealedBids for open-bid lots', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE, isClosedBidding: false });
      (itemService.autoSelectWinner as jest.Mock).mockResolvedValueOnce({
        _id: item._id,
        winningBidder: null,
      });

      await runJob(makeJob(item._id.toString()));

      expect(bidService.decryptSealedBids).not.toHaveBeenCalled();
    });
  });
});
