import { Job, UnrecoverableError, Worker } from 'bullmq';
import { redisConnection } from '../shared/redis';
import { acquireBidLock, releaseBidLock } from '../shared/bid-lock';
import { socketEmitter } from '../shared/socket-emitter';
import { BidJobData, BidJobResult, BID_QUEUE_NAME } from '../queues/bid-queue';
import bidService from '../services/bid-service';
import { Item } from '../models/item-model';
import { Bidder } from '../models/user-model';
import { BidEvent } from '../models/bid-event-model';
import { ESocketEventCode } from '../globals';
import { ForbiddenError, NotFoundError } from '../shared/errors';

/**
 * Start the bid worker.
 *
 * Socket.io events are published via the Redis emitter (`socketEmitter`) rather
 * than a local `Server` reference.  The `@socket.io/redis-adapter` attached to
 * every server instance subscribes to the same Redis channel, so events reach
 * clients regardless of which instance they are connected to.
 *
 * Error handling:
 *  - ForbiddenError / NotFoundError → business logic failure, no retry.
 *    The bidder is notified via their private socket room and the job is
 *    permanently failed (UnrecoverableError).
 *  - Anything else (MongoNetworkError, transient Redis blip, etc.) → re-throw
 *    so BullMQ retries with exponential back-off.  The bidder's UI should show
 *    a "pending" spinner until BID_RESULT arrives.
 *  - Permanent failure after all retries → worker.on('failed') notifies the
 *    bidder so they are never left without feedback.
 */
export function startBidWorker(): Worker<BidJobData, BidJobResult> {
  const worker = new Worker<BidJobData, BidJobResult>(
    BID_QUEUE_NAME,
    async (job: Job<BidJobData>): Promise<BidJobResult> => {
      const { socketId, bidderId, input } = job.data;

      // lockAcquired tracks whether we successfully took the lock.
      // The finally block only releases when we actually hold it.
      let lockToken: string | null = null;
      let lockAcquired = false;

      try {
        // ── Re-fetch bidder ──────────────────────────────────────────────────
        const bidder = await Bidder.findById(bidderId);
        if (!bidder) throw new NotFoundError('Bidder not found');

        // ── Detect auction mode ──────────────────────────────────────────────
        // Advisory read — the service functions enforce authoritative state
        // inside their own transactions (open/sealed) or via direct checks
        // (livestream).
        const item = await Item.findById(input.itemId, {
          isBidIncrementedManually: 1,
          isClosedBidding: 1,
          auctionId: 1,
        });
        if (!item) throw new NotFoundError('Item not found');

        // ── Conditionally acquire lock ───────────────────────────────────────
        // Livestream bids are lock-free: all bidders in a round accept the same
        // called price — concurrent bid-document writes do not conflict.
        // Open and sealed modes still require the lock to serialise competing
        // amounts.
        const isLivestream = item.isBidIncrementedManually;

        if (!isLivestream) {
          lockToken = job.id!;
          lockAcquired = await acquireBidLock(input.itemId, lockToken);
          if (!lockAcquired) {
            // Another worker holds the lock — throw a plain error so BullMQ
            // retries with back-off.
            throw new Error(`Bid lock for item ${input.itemId} is held — retrying`);
          }
        }

        const auctionId = item.auctionId;
        let mode: BidJobResult['mode'];

        // ── Route to mode-specific service ───────────────────────────────────
        let bid;
        if (item.isClosedBidding) {
          bid = await bidService.createSealedBid(bidder as any, input as any);
          mode = 'sealed';
        } else if (item.isBidIncrementedManually) {
          bid = await bidService.createLivestreamBid(bidder as any, input as any);
          mode = 'livestream';
        } else {
          bid = await bidService.createOpenBid(bidder as any, input as any);
          mode = 'open';
        }

        // ── Append BID_PLACED audit event ─────────────────────────────────────
        // Fire-and-forget: we don't await so it cannot stall or fail the bid.
        // A failed write here is logged but does not affect the bidder.
        BidEvent.create({
          eventType: 'BID_PLACED',
          itemId: input.itemId,
          auctionId,
          userId: bidderId,
          bidId: bid.id,
          bidAmount: input.bidAmount,
          auctionMode: mode,
          jobId: job.id,
        }).catch((err: Error) =>
          console.error('[bid-worker] Failed to record BID_PLACED event:', err.message),
        );

        const room = `${bid.itemId.toString()}-bid`;

        // ── Broadcast to item room ────────────────────────────────────────────
        if (mode === 'sealed') {
          // Mode 3: never reveal amount — only signal that bid count grew.
          socketEmitter.to(room).emit(ESocketEventCode.SEALED_BID_ACCEPTED);
        } else {
          // Mode 1 & 2: include full bid data so clients can update their store
          // directly without making a separate HTTP fetchBids call.
          const bidData = bid.toJSON();
          socketEmitter.to(room).emit(ESocketEventCode.UPDATE_BID_AMOUNT, {
            newPrice: bid.bidAmount,
            bid: bidData,
          });

          // Also notify the bidder's private room with the bid data — lets them
          // replace their optimistic entry without an extra HTTP round trip.
          socketEmitter.to(socketId).emit(ESocketEventCode.BID_RESULT, {
            status: 'accepted',
            bidId: bid.id.toString(),
            bid: bidData,
          });
        }

        // ── Notify bidder of success for sealed mode ──────────────────────────
        if (mode === 'sealed') {
          socketEmitter.to(socketId).emit(ESocketEventCode.BID_RESULT, {
            status: 'accepted',
            bidId: bid.id.toString(),
          });
        }

        return { bidId: bid.id.toString(), mode };

      } catch (error: any) {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) {
          // Business logic error — notify bidder and stop retrying.
          socketEmitter.to(socketId).emit(ESocketEventCode.BID_RESULT, {
            status: 'rejected',
            error: error.message,
          });

          // Append BID_REJECTED audit event.
          const rejectedItem = await Item.findById(input.itemId, { auctionId: 1, isBidIncrementedManually: 1, isClosedBidding: 1 }).catch(() => null);
          const rejectionMode: BidJobResult['mode'] = rejectedItem?.isClosedBidding
            ? 'sealed'
            : rejectedItem?.isBidIncrementedManually
              ? 'livestream'
              : 'open';

          BidEvent.create({
            eventType: 'BID_REJECTED',
            itemId: input.itemId,
            auctionId: rejectedItem?.auctionId ?? '000000000000000000000000',
            userId: bidderId,
            bidAmount: input.bidAmount,
            auctionMode: rejectionMode,
            rejectionReason: error.message,
            jobId: job.id,
          }).catch((err: Error) =>
            console.error('[bid-worker] Failed to record BID_REJECTED event:', err.message),
          );

          throw new UnrecoverableError(error.message);
        }

        // Transient error — let BullMQ retry.
        // We do NOT emit BID_RESULT here; the bidder waits for the next attempt.
        throw error;
      } finally {
        // Release the lock only when we actually hold it.
        // The Lua script ensures we only release OUR lock.
        if (lockAcquired && lockToken) await releaseBidLock(input.itemId, lockToken);
      }
    },
    {
      connection: redisConnection,
      // Process up to 10 bids concurrently.  Mongoose transactions are
      // per-document-write so concurrent jobs don't contend on the same session.
      concurrency: 10,
    },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    console.error(
      `[bid-worker] Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? '?'}): ${err.message}`,
    );
    // Only notify the bidder once all retries are genuinely exhausted.
    // This handler fires after EVERY failed attempt, so guard against
    // sending "high demand" prematurely while BullMQ is still retrying.
    // UnrecoverableError means the bidder was already notified inside the
    // processor (business logic rejection) — never double-notify.
    const permanentlyFailed = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!(err instanceof UnrecoverableError) && permanentlyFailed) {
      socketEmitter.to(job.data.socketId).emit(ESocketEventCode.BID_RESULT, {
        status: 'rejected',
        error: 'Your bid could not be processed due to high demand. Please try again.',
      });
    }
  });

  worker.on('error', (err) => {
    console.error('[bid-worker] Worker error:', err.message);
  });

  return worker;
}
