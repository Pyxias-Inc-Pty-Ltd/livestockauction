/**
 * Socket-level integration load test (#122 — socket path).
 *
 * Verifies the full bid pipeline end-to-end, from a socket.io-client
 * emitting CREATE_BID to that same client receiving BID_RESULT:
 *
 *   socket.io-client
 *     → Socket.io server (real HTTP + Redis adapter)
 *       → BullMQ bid queue (real Redis)
 *         → bid worker (real processor)
 *           → socketEmitter (Redis pub/sub)
 *             → Redis adapter delivers BID_RESULT to the right client
 *
 * Prerequisites:
 *   - Redis on localhost:6379  (docker run -d -p 6379:6379 redis:7-alpine)
 *
 * Run with:
 *   npm run test:integration
 */

import { io as ioclient, Socket as ClientSocket } from 'socket.io-client';
import { Types } from 'mongoose';
import { Bidder } from '../../src/models/user-model';
import { Item } from '../../src/models/item-model';
import { ESocketEventCode } from '../../src/globals';
import {
  connectTestDbReplSet,
  disconnectTestDb,
  clearTestDb,
} from '../helpers/db';
import { buildBidder } from '../helpers/factories/user.factory';
import {
  checkRedisAvailable,
  startTestServer,
  TestServer,
} from '../helpers/test-server';

// ─── Constants ────────────────────────────────────────────────────────────────

const N = 100; // concurrent socket clients

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Connect a socket.io client authenticating as the given bidder. */
function connectClient(port: number, bidderId: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioclient(`http://127.0.0.1:${port}`, {
      auth: { testBidderId: bidderId },
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
    });
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
    client.connect();
  });
}

/**
 * Emit CREATE_BID and resolve with { status, latencyMs } once BID_RESULT
 * arrives on the private socket.  Rejects if no result after 30 s.
 */
function sendBid(
  client: ClientSocket,
  itemId: string,
  amount: number,
): Promise<{ status: string; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('BID_RESULT not received within 30 s')),
      30_000,
    );

    const t0 = Date.now();

    client.once(ESocketEventCode.BID_RESULT, (data: any) => {
      clearTimeout(timeout);
      resolve({ status: data.status as string, latencyMs: Date.now() - t0 });
    });

    client.emit(
      ESocketEventCode.CREATE_BID,
      { itemId, bidAmount: amount },
      () => { /* 202 Accepted ack — job enqueued */ },
    );
  });
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

let server: TestServer;

beforeAll(async () => {
  // Fail fast with a clear message if Redis is not running.
  await checkRedisAvailable();

  // MongoDB replica set required — bid-service uses multi-doc transactions.
  await connectTestDbReplSet();

  server = await startTestServer();
}, 60_000);

afterAll(async () => {
  await server?.close();
  await disconnectTestDb();
}, 30_000);

beforeEach(() => clearTestDb());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe(`socket-level bid pipeline (N = ${N} concurrent clients)`, () => {
  it(
    'delivers BID_RESULT to every bidder — zero silent losses',
    async () => {
      // ── Seed data ──────────────────────────────────────────────────────────
      const itemId = new Types.ObjectId();
      const auctionId = new Types.ObjectId();

      await Item.collection.insertOne({
        _id: itemId,
        auctionId,
        title: { en: 'Socket Load Test Item', tn: 'Socket Load Test Item' },
        isClosedBidding: false,
        isBidIncrementedManually: false,
        startingBid: 100,
        bidIncrement: 1,
        reservePrice: 0,
        eligibleBidders: [],
        status: 'ACTIVE',
        publishedStatus: 'PUBLISHED',
        isPurchased: false,
        lotNumber: 1,
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 3_600_000),
        gallery: [],
        version: 0,
      } as any);

      const bidderDocs = Array.from({ length: N }, () => ({
        ...buildBidder(),
        __t: 'Bidder',
      }));
      await Bidder.collection.insertMany(bidderDocs as any[]);

      // ── Connect all clients ────────────────────────────────────────────────
      const clients = await Promise.all(
        bidderDocs.map((b) =>
          connectClient(server.port, (b._id as Types.ObjectId).toHexString()),
        ),
      );

      try {
        // ── Fire all bids simultaneously ───────────────────────────────────
        // All bid the same amount (500 > startingBid=100).
        // The first job processed wins; the rest get ForbiddenError.
        // What matters: every client receives exactly one BID_RESULT.
        const wallStart = Date.now();

        const results = await Promise.all(
          clients.map((client) => sendBid(client, itemId.toHexString(), 500)),
        );

        const wallMs = Date.now() - wallStart;

        // ── Metrics ───────────────────────────────────────────────────────────
        const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
        const accepted = results.filter((r) => r.status === 'accepted').length;
        const rejected = results.filter((r) => r.status === 'rejected').length;

        console.log(`\n── Socket integration load (N=${N}) ──`);
        console.log(`  Wall clock     : ${wallMs} ms`);
        console.log(`  Throughput     : ${Math.round(N / (wallMs / 1_000))} bids/sec`);
        console.log(`  p50 latency    : ${percentile(latencies, 50)} ms`);
        console.log(`  p95 latency    : ${percentile(latencies, 95)} ms`);
        console.log(`  p99 latency    : ${percentile(latencies, 99)} ms`);
        console.log(`  Max latency    : ${latencies[latencies.length - 1]} ms`);
        console.log(`  Accepted       : ${accepted}`);
        console.log(`  Rejected       : ${rejected}`);
        console.log(`  Total notified : ${results.length} / ${N}`);

        // ── Core assertion: every bidder gets exactly one BID_RESULT ──────────
        expect(results).toHaveLength(N);
        expect(accepted + rejected).toBe(N);
        // At least one bid must succeed (the first through the lock).
        expect(accepted).toBeGreaterThanOrEqual(1);
      } finally {
        clients.forEach((c) => c.disconnect());
      }
    },
    90_000,
  );
});
