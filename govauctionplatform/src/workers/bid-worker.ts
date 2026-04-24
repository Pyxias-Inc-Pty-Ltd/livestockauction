import { Job, UnrecoverableError, Worker } from 'bullmq';
import { Server } from 'socket.io';
import { redisConnection } from '../shared/redis';
import { acquireBidLock, releaseBidLock } from '../shared/bid-lock';
import { BidJobData, BidJobResult, BID_QUEUE_NAME } from '../queues/bid-queue';
import bidService from '../services/bid-service';
import { Item } from '../models/item-model';
import { Bidder } from '../models/user-model';
import { BidEvent } from '../models/bid-event-model';
import { ESocketEventCode } from '../globals';
import { ForbiddenError, NotFoundError } from '../shared/errors';

/**
 * Start the bid worker, injecting the Socket.io server so the worker can
 * broadcast results directly — no Redis adapter required for single-instance
 * deployments.
 *
 * Scaling note: if this service is ever deployed with multiple replicas, swap
 * the `io.to(room).emit(...)` calls for `@socket.io/redis-emitter` and add the
 * `@socket.io/redis-adapter` to the Socket.io server setup.
 *
 * Error handling:
 *  - ForbiddenError / NotFoundError → business logic failure, no retry.
 *    The bidder is notified via their private socket room and the job is
 *    permanently failed (UnrecoverableError).
 *  - Anything else (MongoNetworkError, transient Redis blip, etc.) → re-throw
 *    so BullMQ retries with exponential back-off.  The bidder's UI should show
 *    a "pending" spinner until BID_RESULT arrives.
 *
 * @param io  The running Socket.io server instance.
 */
export function startBidWorker(io: Server): Worker<BidJobData, BidJobResult> {
  const worker = new Worker<BidJobData, BidJobResult>(
    BID_QUEUE_NAME,
    async (job: Job<BidJobData>): Promise<BidJobResult> => {
      const { socketId, bidderId, input } = job.data;

      // Use job.id as the lock token — unique per BullMQ job.
      const lockToken = job.id!;
      const acquired = await acquireBidLock(input.itemId, lockToken);

      if (!acquired) {
        // Another worker is currently processing a bid for this item.
        // Throw a plain error so BullMQ retries with back-off.
        throw new Error(`Bid lock for item ${input.itemId} is held — retrying`);
      }

      try {
        // ── Re-fetch bidder ──────────────────────────────────────────────────
        const bidder = await Bidder.findById(bidderId);
        if (!bidder) throw new NotFoundError('Bidder not found');

        // ── Detect auction mode ──────────────────────────────────────────────
        // Advisory read — the service functions enforce authoritative state
        // inside their own transactions.
        const item = await Item.findById(input.itemId, {
          isBidIncrementedManually: 1,
          isClosedBidding: 1,
          auctionId: 1,
        });
        if (!item) throw new NotFoundError('Item not found');

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
          io.to(room).emit(ESocketEventCode.SEALED_BID_ACCEPTED);
        } else {
          // Mode 1 & 2: publish the new leading price.
          io.to(room).emit(ESocketEventCode.UPDATE_BID_AMOUNT, bid.bidAmount);
        }

        // ── Notify bidder of success (private room = socket.id) ───────────────
        io.to(socketId).emit(ESocketEventCode.BID_RESULT, {
          status: 'accepted',
          bidId: bid.id.toString(),
        });

        return { bidId: bid.id.toString(), mode };

      } catch (error: any) {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) {
          // Business logic error — notify bidder and stop retrying.
          io.to(socketId).emit(ESocketEventCode.BID_RESULT, {
            status: 'rejected',
            error: error.message,
          });

          // Append BID_REJECTED audit event.  We do a best-effort lookup of
          // auctionId — if the item doesn't exist, use a zero ObjectId sentinel.
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
        // Always release the lock — even on error — so the next bid for this
        // item isn't blocked.  The Lua script ensures we only release OUR lock.
        await releaseBidLock(input.itemId, lockToken);
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
    if (job) {
      console.error(
        `[bid-worker] Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? '?'}): ${err.message}`,
      );
    }
  });

  worker.on('error', (err) => {
    console.error('[bid-worker] Worker error:', err.message);
  });

  return worker;
}
