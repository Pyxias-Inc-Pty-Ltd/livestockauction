import { Queue } from 'bullmq';
import { redisConnection } from '../shared/redis';

export const BID_QUEUE_NAME = 'bid';

/**
 * Data payload stored in each bid job.
 *
 * We intentionally do not store IBidder here — Mongoose documents cannot be
 * serialised to JSON cleanly.  The worker re-fetches the bidder by ID so
 * it always operates on fresh, authoritative data.
 */
export interface BidJobData {
  /** socket.id of the bidder — used to deliver the result back privately. */
  socketId: string;
  /** MongoDB ObjectId (string) of the bidder placing the bid. */
  bidderId: string;
  /** Raw bid payload as received from the client socket. */
  input: {
    itemId: string;
    bidAmount: number;
    idempotencyKey?: string;
  };
}

/** Shape of the value resolved by a successful bid job. */
export interface BidJobResult {
  bidId: string;
  mode: 'open' | 'livestream' | 'sealed';
}

export const bidQueue = new Queue<BidJobData, BidJobResult>(BID_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1_000,
    },
    // Keep completed jobs for 1 hour (useful for debugging / idempotency checks).
    // Keep failed jobs for 24 hours so ops can inspect them.
    removeOnComplete: { age: 3_600 },
    removeOnFail: { age: 86_400 },
  },
});
