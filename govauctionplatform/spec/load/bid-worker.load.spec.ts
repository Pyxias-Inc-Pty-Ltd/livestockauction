/**
 * Load test for the bid-worker processor (#122).
 *
 * Verifies three guarantees under N = 1 000 concurrent bid jobs:
 *
 *  1. All-success path   — every bidder receives BID_RESULT accepted.
 *  2. All-rejected path  — every bidder receives BID_RESULT rejected (no silent losses).
 *  3. Lock-contention    — after all retries exhausted the failed handler still
 *                          delivers BID_RESULT rejected to every bidder.
 *
 * Strategy: same mock approach as bid-worker.spec.ts — capture the processor
 * from the mocked Worker constructor and invoke it with N fake Jobs against a
 * real MongoMemoryServer.  No actual Redis or BullMQ daemon required.
 */

jest.setTimeout(60_000);

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

jest.mock('bullmq', () => {
  const { UnrecoverableError } = jest.requireActual('bullmq');
  return { Worker: jest.fn(), UnrecoverableError };
});

jest.mock('../../src/queues/bid-queue', () => ({ BID_QUEUE_NAME: 'bid' }));
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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Worker } from 'bullmq';
import { Types } from 'mongoose';
import { acquireBidLock, releaseBidLock } from '../../src/shared/bid-lock';
import { socketEmitter } from '../../src/shared/socket-emitter';
import bidService from '../../src/services/bid-service';
import { startBidWorker } from '../../src/workers/bid-worker';
import { Item } from '../../src/models/item-model';
import { Bidder } from '../../src/models/user-model';
import { ESocketEventCode } from '../../src/globals';
import { ForbiddenError } from '../../src/shared/errors';
import { connectTestDb, disconnectTestDb, clearTestDb } from '../helpers/db';
import { buildBidder } from '../helpers/factories/user.factory';

// ─── Constants ────────────────────────────────────────────────────────────────

const N = 1_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

let runJob: (job: any) => Promise<any>;
let workerHandlers: Record<string, Function>;

const emittedEvents = () =>
  (socketEmitter as any)._emittedEvents as { room: string; event: string; args: any[] }[];

/** Compute the p-th percentile of a pre-sorted array. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function makeStubBid(itemId: Types.ObjectId) {
  const _id = new Types.ObjectId();
  const bid = { _id, id: _id, itemId, bidAmount: 1_000 };
  return { ...bid, toJSON: () => bid };
}

/** Seed N bidder documents directly (bypasses schema validation for speed). */
async function seedBidders(n: number): Promise<ReturnType<typeof buildBidder>[]> {
  const docs = Array.from({ length: n }, () => ({ ...buildBidder(), __t: 'Bidder' }));
  await Bidder.collection.insertMany(docs as any[]);
  return docs;
}

/** Seed a minimal open-bid item. */
async function seedItem(itemId: Types.ObjectId, auctionId: Types.ObjectId) {
  await Item.collection.insertOne({
    _id: itemId,
    auctionId,
    title: { en: 'Load Test Item', tn: 'Load Test Item' },
    isClosedBidding: false,
    isBidIncrementedManually: false,
    startingBid: 500,
    bidIncrement: 100,
    reservePrice: 0,
  } as any);
}

/** Build N fake BullMQ job objects — one per bidder. */
function makeJobs(
  bidders: ReturnType<typeof buildBidder>[],
  itemId: Types.ObjectId,
  suffix = '',
) {
  return bidders.map((b, i) => ({
    id: `load${suffix}-${i}`,
    data: {
      socketId: `socket${suffix}-${i}`,
      bidderId: (b._id as Types.ObjectId).toHexString(),
      input: { itemId: itemId.toHexString(), bidAmount: 1_000 + i * 100 },
    },
    opts: { attempts: 3 },
    attemptsMade: 1,
  }));
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

beforeAll(() => connectTestDb());
afterAll(() => disconnectTestDb());

beforeEach(async () => {
  jest.clearAllMocks();
  (socketEmitter as any)._reset();

  workerHandlers = {};
  (Worker as unknown as jest.Mock).mockImplementation(
    (_name: string, processor: Function) => {
      runJob = processor as (job: any) => Promise<any>;
      return {
        on: jest.fn((event: string, handler: Function) => {
          workerHandlers[event] = handler;
        }),
      };
    },
  );

  (acquireBidLock as jest.Mock).mockResolvedValue(true);
  (releaseBidLock as jest.Mock).mockResolvedValue(undefined);

  startBidWorker();
  await clearTestDb();
});

// ─── Load scenarios ───────────────────────────────────────────────────────────

describe(`bid-worker load (N = ${N})`, () => {
  // ── Scenario 1: all bids succeed ──────────────────────────────────────────

  it('accepts all N bids and emits BID_RESULT accepted to every bidder', async () => {
    const itemId = new Types.ObjectId();
    const auctionId = new Types.ObjectId();
    await seedItem(itemId, auctionId);
    const bidders = await seedBidders(N);
    const jobs = makeJobs(bidders, itemId, '-ok');

    (bidService.createOpenBid as jest.Mock).mockImplementation(async () =>
      makeStubBid(itemId),
    );

    // ── Run all N jobs concurrently ──────────────────────────────────────────
    const wallStart = Date.now();
    const latencies: number[] = [];

    const outcomes = await Promise.allSettled(
      jobs.map(async (job) => {
        const t0 = performance.now();
        const result = await runJob(job);
        latencies.push(performance.now() - t0);
        return result;
      }),
    );

    const wallMs = Date.now() - wallStart;
    latencies.sort((a, b) => a - b);

    const succeeded = outcomes.filter((r) => r.status === 'fulfilled').length;
    const failed = outcomes.filter((r) => r.status === 'rejected').length;

    // ── Report ────────────────────────────────────────────────────────────────
    console.log(`\n── Scenario 1: all-success (N=${N}) ──`);
    console.log(`  Wall clock  : ${wallMs} ms`);
    console.log(
      `  Throughput  : ${Math.round(N / (wallMs / 1_000))} bids/sec`,
    );
    console.log(`  p50 latency : ${percentile(latencies, 50).toFixed(2)} ms`);
    console.log(`  p95 latency : ${percentile(latencies, 95).toFixed(2)} ms`);
    console.log(`  p99 latency : ${percentile(latencies, 99).toFixed(2)} ms`);
    console.log(`  Max latency : ${latencies[latencies.length - 1].toFixed(2)} ms`);
    console.log(`  Succeeded   : ${succeeded}  |  Failed: ${failed}`);

    // ── Assertions ────────────────────────────────────────────────────────────
    expect(succeeded).toBe(N);

    const bidResults = emittedEvents().filter(
      (e) => e.event === ESocketEventCode.BID_RESULT,
    );
    // Every bidder must receive exactly one BID_RESULT — zero silent losses.
    expect(bidResults).toHaveLength(N);
    expect(bidResults.every((e) => e.args[0].status === 'accepted')).toBe(true);

    // Lock must be released once per job even on the happy path.
    expect(releaseBidLock).toHaveBeenCalledTimes(N);
  });

  // ── Scenario 2: all bids rejected (ForbiddenError) ───────────────────────

  it('rejects all N bids and emits BID_RESULT rejected to every bidder — no silent losses', async () => {
    const itemId = new Types.ObjectId();
    const auctionId = new Types.ObjectId();
    await seedItem(itemId, auctionId);
    const bidders = await seedBidders(N);
    const jobs = makeJobs(bidders, itemId, '-rej');

    (bidService.createOpenBid as jest.Mock).mockRejectedValue(
      new ForbiddenError('Bidding not allowed'),
    );

    // ── Run all N jobs concurrently ──────────────────────────────────────────
    const wallStart = Date.now();
    const outcomes = await Promise.allSettled(
      jobs.map((job) => runJob(job)),
    );
    const wallMs = Date.now() - wallStart;

    const threwUnrecoverable = outcomes.filter((r) => r.status === 'rejected').length;

    console.log(`\n── Scenario 2: all-rejected (N=${N}) ──`);
    console.log(`  Wall clock          : ${wallMs} ms`);
    console.log(`  UnrecoverableErrors : ${threwUnrecoverable}`);

    // ── Assertions ────────────────────────────────────────────────────────────
    expect(threwUnrecoverable).toBe(N); // each job must throw UnrecoverableError

    const bidResults = emittedEvents().filter(
      (e) => e.event === ESocketEventCode.BID_RESULT,
    );
    // Every bidder must still be notified — zero silent losses even on rejection.
    expect(bidResults).toHaveLength(N);
    expect(bidResults.every((e) => e.args[0].status === 'rejected')).toBe(true);

    // Lock must be released in finally even when a ForbiddenError is thrown.
    expect(releaseBidLock).toHaveBeenCalledTimes(N);
  });

  // ── Scenario 3: lock always held — failed handler must notify bidders ─────

  it(
    'delivers BID_RESULT rejected via failed handler when lock contention exhausts all retries',
    async () => {
      const itemId = new Types.ObjectId();
      const auctionId = new Types.ObjectId();
      await seedItem(itemId, auctionId);
      const bidders = await seedBidders(N);

      // Every lock attempt fails — simulates a hot item under sustained load.
      (acquireBidLock as jest.Mock).mockResolvedValue(false);

      // Jobs at their final attempt (attemptsMade === attempts).
      const jobs = makeJobs(bidders, itemId, '-lock').map((j) => ({
        ...j,
        attemptsMade: 3,
      }));

      // ── All processor calls throw (lock held) ────────────────────────────
      const wallStart = Date.now();
      await Promise.allSettled(jobs.map((job) => runJob(job)));
      const processorMs = Date.now() - wallStart;

      // No BID_RESULT yet — the processor throws before emitting.
      expect(
        emittedEvents().filter((e) => e.event === ESocketEventCode.BID_RESULT),
      ).toHaveLength(0);

      // ── Simulate BullMQ exhausting all retries → calls worker.on('failed') ─
      const lockErr = new Error('Bid lock for item X is held — retrying');
      const failedStart = Date.now();
      jobs.forEach((job) => workerHandlers['failed'](job, lockErr));
      const failedMs = Date.now() - failedStart;

      console.log(`\n── Scenario 3: lock-contention (N=${N}) ──`);
      console.log(`  Processor phase : ${processorMs} ms`);
      console.log(`  Failed handler  : ${failedMs} ms`);

      // ── Assertions ──────────────────────────────────────────────────────────
      const bidResults = emittedEvents().filter(
        (e) => e.event === ESocketEventCode.BID_RESULT,
      );
      // Every bidder must be notified — this is the fix from issue #120.
      expect(bidResults).toHaveLength(N);
      expect(bidResults.every((e) => e.args[0].status === 'rejected')).toBe(true);
      expect(
        bidResults.every((e) =>
          (e.args[0].error as string).includes('high demand'),
        ),
      ).toBe(true);

      // Lock release should NOT have been called (lock was never acquired).
      expect(releaseBidLock).not.toHaveBeenCalled();
    },
  );
});
