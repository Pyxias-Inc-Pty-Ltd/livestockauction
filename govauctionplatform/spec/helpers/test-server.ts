/**
 * Minimal HTTP + Socket.io server for integration tests.
 *
 * Deliberately does NOT import src/index.ts (which starts listening
 * immediately) or src/workers/bid-worker.ts (whose import chain reaches
 * forum-model → src/index.ts via circular references).
 *
 * Instead it assembles only what the socket integration tests need:
 *   - Socket.io on a random free port
 *   - Keycloak auth middleware with the NODE_ENV=test bidder-ID bypass
 *   - CREATE_BID handler → enqueues to the real BullMQ bid queue
 *   - @socket.io/redis-adapter so socketEmitter events reach connected clients
 *   - A lightweight BullMQ Worker with a minimal processor that proves the
 *     full transport path (socket → queue → worker → socketEmitter → client)
 *     without importing the full bid-service chain
 *
 * Requires a real Redis on localhost:6379.
 * Use checkRedisAvailable() in beforeAll to fail fast if Redis is absent.
 */

import { createServer, Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Worker, Queue, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import StatusCodes from 'http-status-codes';
import { socketEmitter } from '../../src/shared/socket-emitter';
import { BID_QUEUE_NAME, BidJobData, BidJobResult } from '../../src/queues/bid-queue';
import { ESocketEventCode } from '../../src/globals';
import { Bidder, IBidder } from '../../src/models/user-model';

const { ACCEPTED, INTERNAL_SERVER_ERROR } = StatusCodes;

export interface TestServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Ping Redis and throw a descriptive error if it is unreachable.
 * Call this at the top of beforeAll so the test fails fast with a
 * human-readable message instead of hanging on connection timeouts.
 */
export async function checkRedisAvailable(): Promise<void> {
  const client = new IORedis({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
  try {
    await client.ping();
  } catch {
    throw new Error(
      'Redis is not available on localhost:6379.\n' +
      'Start Redis before running integration tests:\n' +
      '  docker run -d -p 6379:6379 redis:7-alpine\n' +
      '  # or: brew services start redis',
    );
  } finally {
    client.disconnect();
  }
}

/** Start the integration test server and a lightweight bid worker. */
export async function startTestServer(): Promise<TestServer> {
  const httpServer = createServer((_req, res) => res.end('ok'));

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket'],
  });

  // Redis adapter — needed so socketEmitter events reach connected clients.
  const pubClient = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  // Integration-test auth — accepts a pre-seeded bidder ID directly.
  // Avoids importing auth-handler.ts (which depends on jose, an ESM-only
  // package that cannot run in Jest's CommonJS environment).
  io.use(async (socket: any, next: any) => {
    const testBidderId = socket.handshake.auth?.testBidderId;
    if (!testBidderId) {
      next(new Error('Unauthorized: testBidderId required in integration tests'));
      return;
    }
    try {
      const user = await Bidder.findById(testBidderId);
      if (!user) { next(new Error('Test bidder not found')); return; }
      socket.user = user;
      next();
    } catch (err) {
      next(err);
    }
  });

  // CREATE_BID handler — enqueues to the real BullMQ queue.
  const bidQueue = new Queue<BidJobData, BidJobResult>(BID_QUEUE_NAME, {
    connection: new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null }),
    defaultJobOptions: { attempts: 3, removeOnComplete: true, removeOnFail: true },
  });

  io.on('connection', (socket: Socket) => {
    socket.on(ESocketEventCode.CREATE_BID, async (data: any, cb: any) => {
      try {
        const bidder = (socket as any).user as IBidder;
        await bidQueue.add('bid', {
          socketId: socket.id,
          bidderId: bidder.id.toString(),
          input: data,
        });
        cb({ status: ACCEPTED });
      } catch (err: any) {
        cb({ status: INTERNAL_SERVER_ERROR, msg: err.message });
      }
    });
  });

  // Lightweight worker — exercises the full transport path without importing
  // the production bid-service chain (which has a circular dependency on
  // src/index.ts via forum-model).
  //
  // Behaviour mirrors bid-worker.ts:
  //   - First bid for an item succeeds (accepted).
  //   - Subsequent bids for the same item are rejected (ForbiddenError).
  //   - Transient errors rethrow so BullMQ can retry.
  //   - worker.on('failed') notifies the bidder if all retries exhaust.
  const seenItems = new Set<string>();

  const worker = new Worker<BidJobData, BidJobResult>(
    BID_QUEUE_NAME,
    async (job) => {
      const { socketId, input } = job.data;
      const { itemId, bidAmount } = input;

      // Simulate: first bid on an item wins; others are rejected.
      if (seenItems.has(itemId)) {
        socketEmitter.to(socketId).emit(ESocketEventCode.BID_RESULT, {
          status: 'rejected',
          error: 'A higher bid has already been placed.',
        });
        throw new UnrecoverableError('Bid too low');
      }

      seenItems.add(itemId);
      const fakeBidId = `test-bid-${Date.now()}`;

      const room = `${itemId}-bid`;
      socketEmitter.to(room).emit(ESocketEventCode.UPDATE_BID_AMOUNT, {
        newPrice: bidAmount,
        bid: { _id: fakeBidId, itemId, bidAmount },
      });
      socketEmitter.to(socketId).emit(ESocketEventCode.BID_RESULT, {
        status: 'accepted',
        bidId: fakeBidId,
      });

      return { bidId: fakeBidId, mode: 'open' };
    },
    {
      connection: new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null }),
      concurrency: 10,
    },
  );

  worker.on('failed', (job, err) => {
    if (!job || err instanceof UnrecoverableError) return;
    socketEmitter.to(job.data.socketId).emit(ESocketEventCode.BID_RESULT, {
      status: 'rejected',
      error: 'Your bid could not be processed. Please try again.',
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as { port: number }).port;

  const close = async () => {
    await worker.close();
    await bidQueue.close();
    await io.close();
    pubClient.disconnect();
    subClient.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { port, close };
}
