import { Queue } from 'bullmq';
import { redisConnection } from '../shared/redis';

export const CLOSE_LOT_QUEUE_NAME = 'close-lot';

export interface CloseLotJobData {
  itemId: string;
}

export const closeLotQueue = new Queue<CloseLotJobData>(CLOSE_LOT_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: { age: 86_400 },
  },
});

/** Deterministic job ID — one delayed job per item at a time. */
export function closeLotJobId(itemId: string): string {
  return `close-lot:${itemId}`;
}

/**
 * Schedule (or reschedule) the close-lot job for a lot.
 *
 * Safe to call multiple times — removes any existing delayed job for the same
 * itemId before adding the new one, so endTime edits don't produce duplicates.
 *
 * If endTime is already in the past the job is skipped; the cron safety net
 * (trackItemStatus) will handle it on its next tick.
 */
export async function scheduleCloseLot(itemId: string, endTime: Date): Promise<void> {
  const delay = endTime.getTime() - Date.now();
  if (delay <= 0) return;

  const jobId = closeLotJobId(itemId);
  // Remove existing delayed job (e.g. after endTime was edited).
  await closeLotQueue.remove(jobId).catch(() => {});
  await closeLotQueue.add('close-lot', { itemId }, { delay, jobId });
}
