/**
 * Chaos / resilience tests for the bid-worker processor (#122).
 *
 * These tests inject realistic failure conditions to verify the worker
 * degrades gracefully and NEVER silently drops a bidder notification:
 *
 *  Scenario A — slow service (200 ms DB transaction latency)
 *               All bids still succeed; every bidder gets BID_RESULT accepted.
 *
 *  Scenario B — 10 % transient failures (MongoNetworkError mid-batch)
 *               Failing jobs rethrow for BullMQ retry.  After retries
 *               exhausted the failed handler delivers BID_RESULT rejected.
 *               Combined: 100 % of bidders notified, zero silent losses.
 *
 *  Scenario C — 100 % transient failure (total DB outage)
 *               Every job throws.  After retries exhausted the failed
 *               handler notifies every bidder.  No bidder is left hanging.
 *
 *  Scenario D — mixed chaos (slow + failures + business errors)
 *               Closest to production worst-case.  Slow jobs, transient
 *               failures, and ForbiddenErrors are interleaved.  Every
 *               bidder still gets exactly one BID_RESULT.
 */

jest.setTimeout(120_000);

// ─── Module mocks ─────────────────────────────────────────────────────────────

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

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Worker, UnrecoverableError } from 'bullmq';
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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function makeStubBid(itemId: Types.ObjectId) {
  const _id = new Types.ObjectId();
  const bid = { _id, id: _id, itemId, bidAmount: 1_000 };
  return { ...bid, toJSON: () => bid };
}

async function seedBidders(n: number) {
  const docs = Array.from({ length: n }, () => ({ ...buildBidder(), __t: 'Bidder' }));
  await Bidder.collection.insertMany(docs as any[]);
  return docs;
}

async function seedItem(itemId: Types.ObjectId, auctionId: Types.ObjectId) {
  await Item.collection.insertOne({
    _id: itemId,
    auctionId,
    title: { en: 'Chaos Test Item', tn: 'Chaos Test Item' },
    isClosedBidding: false,
    isBidIncrementedManually: false,
    startingBid: 500,
    bidIncrement: 100,
    reservePrice: 0,
  } as any);
}

function makeJobs(
  bidders: ReturnType<typeof buildBidder>[],
  itemId: Types.ObjectId,
  suffix = '',
) {
  return bidders.map((b, i) => ({
    id: `chaos${suffix}-${i}`,
    data: {
      socketId: `socket${suffix}-${i}`,
      bidderId: (b._id as Types.ObjectId).toHexString(),
      input: { itemId: itemId.toHexString(), bidAmount: 1_000 },
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

// ─── Chaos scenarios ──────────────────────────────────────────────────────────

describe(`bid-worker chaos (N = ${N})`, () => {
  // ── Scenario A: slow service (200 ms DB transaction latency) ──────────────

  it('A — slow service (200 ms/bid): all N bidders receive BID_RESULT accepted', async () => {
    const itemId = new Types.ObjectId();
    await seedItem(itemId, new Types.ObjectId());
    const bidders = await seedBidders(N);
    const jobs = makeJobs(bidders, itemId, '-slow');

    (bidService.createOpenBid as jest.Mock).mockImplementation(async () => {
      await delay(200);
      return makeStubBid(itemId);
    });

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

    console.log(`\n── Scenario A: slow service 200 ms (N=${N}) ──`);
    console.log(`  Wall clock  : ${wallMs} ms`);
    console.log(`  Throughput  : ${Math.round(N / (wallMs / 1_000))} bids/sec`);
    console.log(`  p50 latency : ${percentile(latencies, 50).toFixed(0)} ms`);
    console.log(`  p95 latency : ${percentile(latencies, 95).toFixed(0)} ms`);
    console.log(`  p99 latency : ${percentile(latencies, 99).toFixed(0)} ms`);

    const succeeded = outcomes.filter((r) => r.status === 'fulfilled').length;
    console.log(`  Succeeded   : ${succeeded}`);

    expect(succeeded).toBe(N);

    const bidResults = emittedEvents().filter(
      (e) => e.event === ESocketEventCode.BID_RESULT,
    );
    expect(bidResults).toHaveLength(N);
    expect(bidResults.every((e) => e.args[0].status === 'accepted')).toBe(true);
  });

  // ── Scenario B: 10 % transient failures ───────────────────────────────────

  it('B — 10 % transient failures: 100 % of bidders notified (90 % accepted, 10 % via failed handler)', async () => {
    const itemId = new Types.ObjectId();
    await seedItem(itemId, new Types.ObjectId());
    const bidders = await seedBidders(N);
    const jobs = makeJobs(bidders, itemId, '-trans10');

    const FAILURE_RATE = 0.1;
    let callCount = 0;
    (bidService.createOpenBid as jest.Mock).mockImplementation(async () => {
      if (++callCount % Math.round(1 / FAILURE_RATE) === 0) {
        throw new Error('MongoNetworkError: connection timed out');
      }
      return makeStubBid(itemId);
    });

    // Run all jobs — transient failures throw (no BID_RESULT from processor).
    const outcomes = await Promise.allSettled(jobs.map((job) => runJob(job)));

    const succeeded = outcomes.filter((r) => r.status === 'fulfilled').length;
    const threwTransient = outcomes
      .filter((r) => r.status === 'rejected')
      .filter(
        (r) => !((r as PromiseRejectedResult).reason instanceof UnrecoverableError),
      ).length;

    // Simulate BullMQ exhausting retries for the transient-failed jobs.
    const transientErr = new Error('MongoNetworkError: connection timed out');
    jobs.forEach((job, i) => {
      if (outcomes[i].status === 'rejected') {
        workerHandlers['failed']({ ...job, attemptsMade: 3 }, transientErr);
      }
    });

    const bidResults = emittedEvents().filter(
      (e) => e.event === ESocketEventCode.BID_RESULT,
    );
    const accepted = bidResults.filter((e) => e.args[0].status === 'accepted').length;
    const rejected = bidResults.filter((e) => e.args[0].status === 'rejected').length;

    console.log(`\n── Scenario B: 10 % transient failures (N=${N}) ──`);
    console.log(`  Succeeded (processor)  : ${succeeded}`);
    console.log(`  Threw transient error  : ${threwTransient}`);
    console.log(`  BID_RESULT accepted    : ${accepted}`);
    console.log(`  BID_RESULT rejected    : ${rejected}`);
    console.log(`  Total notified         : ${bidResults.length} / ${N}`);

    // Every bidder must be notified — zero silent losses.
    expect(bidResults).toHaveLength(N);
    expect(accepted + rejected).toBe(N);
  });

  // ── Scenario C: 100 % transient failure (total DB outage) ─────────────────

  it('C — total DB outage: every bidder notified via failed handler, zero silent losses', async () => {
    const itemId = new Types.ObjectId();
    await seedItem(itemId, new Types.ObjectId());
    const bidders = await seedBidders(N);
    const jobs = makeJobs(bidders, itemId, '-outage').map((j) => ({
      ...j,
      attemptsMade: 3, // final attempt
    }));

    const dbErr = new Error('MongoNetworkError: topology was destroyed');
    (bidService.createOpenBid as jest.Mock).mockRejectedValue(dbErr);

    // All jobs throw — the processor correctly rethrows transient errors.
    await Promise.allSettled(jobs.map((job) => runJob(job)));

    // No BID_RESULT emitted yet — correct, bidder waits for retry.
    expect(
      emittedEvents().filter((e) => e.event === ESocketEventCode.BID_RESULT),
    ).toHaveLength(0);

    // BullMQ exhausts all retries → calls worker.on('failed') for each job.
    jobs.forEach((job) => workerHandlers['failed'](job, dbErr));

    const bidResults = emittedEvents().filter(
      (e) => e.event === ESocketEventCode.BID_RESULT,
    );

    console.log(`\n── Scenario C: total DB outage (N=${N}) ──`);
    console.log(`  Total notified : ${bidResults.length} / ${N}`);

    // Every bidder must receive BID_RESULT rejected — none left hanging.
    expect(bidResults).toHaveLength(N);
    expect(bidResults.every((e) => e.args[0].status === 'rejected')).toBe(true);
    expect(
      bidResults.every((e) =>
        (e.args[0].error as string).includes('high demand'),
      ),
    ).toBe(true);
  });

  // ── Scenario D: mixed chaos (slow + transient + business errors) ───────────

  it('D — mixed chaos: every bidder gets exactly one BID_RESULT regardless of failure mode', async () => {
    const itemId = new Types.ObjectId();
    await seedItem(itemId, new Types.ObjectId());
    const bidders = await seedBidders(N);
    const jobs = makeJobs(bidders, itemId, '-mixed');

    // Distribute failure types across the batch deterministically by bucket:
    //   bucket 0       → 10 % business error (ForbiddenError, no retry)
    //   buckets 8, 9   → 20 % transient error (MongoNetworkError, BullMQ retries)
    //   buckets 1 – 7  → 70 % slow success (50 ms each)
    let callCount = 0;
    (bidService.createOpenBid as jest.Mock).mockImplementation(async () => {
      const bucket = ++callCount % 10;
      if (bucket === 0) {
        throw new ForbiddenError('Bidding closed for this lot');
      }
      if (bucket >= 8) {
        throw new Error('MongoNetworkError: connection timed out');
      }
      await delay(50);
      return makeStubBid(itemId);
    });

    const wallStart = Date.now();
    const outcomes = await Promise.allSettled(jobs.map((job) => runJob(job)));
    const wallMs = Date.now() - wallStart;

    const processorSucceeded = outcomes.filter((r) => r.status === 'fulfilled').length;
    const unrecoverable = outcomes
      .filter((r) => r.status === 'rejected')
      .filter(
        (r) => (r as PromiseRejectedResult).reason instanceof UnrecoverableError,
      ).length;
    const transientThrows = outcomes
      .filter((r) => r.status === 'rejected')
      .filter(
        (r) => !((r as PromiseRejectedResult).reason instanceof UnrecoverableError),
      ).length;

    // Simulate BullMQ exhausting retries for the transient failures.
    const transientErr = new Error('MongoNetworkError: connection timed out');
    jobs.forEach((job, i) => {
      const outcome = outcomes[i];
      if (
        outcome.status === 'rejected' &&
        !(outcome.reason instanceof UnrecoverableError)
      ) {
        workerHandlers['failed']({ ...job, attemptsMade: 3 }, transientErr);
      }
    });

    const bidResults = emittedEvents().filter(
      (e) => e.event === ESocketEventCode.BID_RESULT,
    );
    const accepted = bidResults.filter((e) => e.args[0].status === 'accepted').length;
    const rejected = bidResults.filter((e) => e.args[0].status === 'rejected').length;

    console.log(`\n── Scenario D: mixed chaos (N=${N}) ──`);
    console.log(`  Wall clock             : ${wallMs} ms`);
    console.log(`  Processor succeeded    : ${processorSucceeded}  (70 % target: ${N * 0.7})`);
    console.log(`  Business errors        : ${unrecoverable}  (10 % target: ${N * 0.1})`);
    console.log(`  Transient errors       : ${transientThrows}  (20 % target: ${N * 0.2})`);
    console.log(`  BID_RESULT accepted    : ${accepted}`);
    console.log(`  BID_RESULT rejected    : ${rejected}`);
    console.log(`  Total notified         : ${bidResults.length} / ${N}`);

    // Core guarantee: every single bidder gets exactly one BID_RESULT.
    expect(bidResults).toHaveLength(N);
    expect(accepted + rejected).toBe(N);

    // Sanity: proportions roughly match the injected rates (±5 %).
    expect(processorSucceeded).toBeGreaterThanOrEqual(N * 0.65);
    expect(processorSucceeded).toBeLessThanOrEqual(N * 0.75);
    expect(unrecoverable).toBeGreaterThanOrEqual(N * 0.05);
    expect(unrecoverable).toBeLessThanOrEqual(N * 0.15);
  });
});
