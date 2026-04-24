import cron from 'node-cron';
import logger from 'jet-logger';
import { redisConnection } from './shared/redis';
import transactionService from './services/transaction-service';
import auctionService from './services/auction-service';
import itemService from './services/item-service';
import collectionService from './services/collection-service';

/**
 * TTL for cron distributed locks (seconds).
 * Set slightly under the shortest cron interval (60s) so a crashed run
 * never blocks the next tick indefinitely.
 */
const LOCK_TTL_S = 55;

/**
 * Acquire a Redis-backed distributed lock, run `fn`, then release.
 * If another instance already holds the lock the job is silently skipped —
 * exactly-once execution per tick across all instances.
 */
async function withCronLock(jobName: string, fn: () => Promise<void>): Promise<void> {
  const key = `cron-lock:${jobName}`;
  const acquired = await redisConnection.set(key, '1', 'EX', LOCK_TTL_S, 'NX');
  if (!acquired) return;
  try {
    await fn();
  } catch (err) {
    logger.err(`[cron] ${jobName} failed: ${(err as Error).message}`);
  } finally {
    await redisConnection.del(key);
  }
}

export function startCronJobs(): void {
  // ── Every minute ──────────────────────────────────────────────────────────

  cron.schedule('* * * * *', () => {
    withCronLock('trackTransactionStatus', () =>
      transactionService.trackTransactionStatus(),
    );
  });

  cron.schedule('* * * * *', () => {
    withCronLock('trackAuctionStatus', () =>
      auctionService.trackAuctionStatus(),
    );
  });

  cron.schedule('* * * * *', () => {
    withCronLock('trackItemStatus', async () => {
      await itemService.trackItemStatus();

      // After winners are assigned, initiate refunds for non-winning bidders.
      const items = await itemService.getItemsWithWinnerForRefund();
      await Promise.allSettled(
        items.map((item) =>
          transactionService.initiateNonWinnerReservationRefunds(
            item._id.toString(),
            item.winningBidder!.toString(),
          ),
        ),
      );
    });
  });

  // ── Every hour ────────────────────────────────────────────────────────────

  cron.schedule('0 * * * *', () => {
    withCronLock('trackCollectionStatus', () =>
      collectionService.trackCollectionStatus(),
    );
  });

  logger.info('Cron jobs started');
}
