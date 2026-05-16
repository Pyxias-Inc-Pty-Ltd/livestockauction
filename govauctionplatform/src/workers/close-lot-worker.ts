import { Job, Worker } from 'bullmq';
import { redisConnection } from '../shared/redis';
import { socketEmitter } from '../shared/socket-emitter';
import { CLOSE_LOT_QUEUE_NAME, CloseLotJobData } from '../queues/close-lot-queue';
import { ESocketEventCode, EItemStatus } from '../globals';
import itemService from '../services/item-service';
import bidService from '../services/bid-service';
import { Item } from '../models/item-model';

/**
 * Worker that closes a lot at its endTime and selects a winner.
 *
 * This is the primary close path — fires at exactly endTime via a BullMQ
 * delayed job scheduled when the lot is created or its endTime is updated.
 *
 * The cron (trackItemStatus) remains a safety net:
 *   - Catches lots whose close job was lost on server restart or Redis flush.
 *   - Handles auction-cascade closes (parent auction ends before lot's endTime).
 *   - Handles orphaned lots.
 *
 * Idempotent: if the lot is already ENDED (cron beat us) the job exits cleanly.
 */
export function startCloseLotWorker(): Worker<CloseLotJobData> {
  const worker = new Worker<CloseLotJobData>(
    CLOSE_LOT_QUEUE_NAME,
    async (job: Job<CloseLotJobData>) => {
      const { itemId } = job.data;

      const item = await Item.findById(itemId, {
        status: 1,
        isClosedBidding: 1,
        winningBidder: 1,
      });

      if (!item) {
        console.warn(`[close-lot-worker] Item ${itemId} not found — skipping`);
        return;
      }

      // Cron may have already closed this lot — nothing to do.
      if (item.status === EItemStatus.ENDED) return;

      // Close the lot.
      await Item.findByIdAndUpdate(itemId, { $set: { status: EItemStatus.ENDED } });

      // Sealed lots: decrypt bids before winner selection so amounts are readable.
      if (item.isClosedBidding) {
        await bidService.decryptSealedBids(itemId).catch((err: Error) =>
          console.error(
            `[close-lot-worker] Failed to decrypt sealed bids for ${itemId}: ${err.message}`,
          ),
        );
      }

      // Select winner and notify the bidding room.
      const updated = await itemService.autoSelectWinner(itemId);
      if (updated?.winningBidder) {
        socketEmitter
          .to(`${itemId}-bid`)
          .emit(ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING, itemId);
      }
    },
    {
      connection: redisConnection,
      concurrency: 20,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[close-lot-worker] Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('[close-lot-worker] Worker error:', err.message);
  });

  return worker;
}
