import IORedis from 'ioredis';
import { REDIS_HOST, REDIS_PORT, REDIS_PASS } from '../globals';

/**
 * A dedicated IORedis connection for distributed bid locks.
 *
 * Using a separate connection prevents lock commands from being queued behind
 * BullMQ's blocking operations on the shared `redisConnection`.
 */
const lockRedis = new IORedis({
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASS || undefined,
  maxRetriesPerRequest: null,
});

/**
 * How long (ms) a lock is held before it auto-expires.
 *
 * This is a safety net — the lock should always be released explicitly by
 * `releaseBidLock`.  The TTL prevents a crashed worker from blocking the
 * item queue indefinitely.
 *
 * 5 seconds is generous for a MongoDB ACID transaction, which typically
 * completes in < 50 ms on a healthy replica set.
 */
const LOCK_TTL_MS = 5_000;

/** Redis key prefix for per-item bid locks. */
const lockKey = (itemId: string) => `bid-lock:${itemId}`;

/**
 * Acquire an exclusive distributed lock for the given item.
 *
 * Uses SET NX PX (atomic set-if-not-exists with millisecond expiry) — the
 * safest single-command acquire pattern for Redis.
 *
 * @param itemId  The item being bid on.
 * @param token   A unique string (e.g. job.id) that identifies the lock owner.
 *                Must be passed to `releaseBidLock` to prevent a different
 *                worker from accidentally releasing a lock it doesn't hold.
 * @returns       `true` if the lock was acquired; `false` if another worker
 *                holds it.
 */
export async function acquireBidLock(itemId: string, token: string): Promise<boolean> {
  const result = await lockRedis.set(
    lockKey(itemId),
    token,
    'PX', LOCK_TTL_MS,
    'NX',
  );
  return result === 'OK';
}

/**
 * Release the distributed lock, but ONLY if the calling worker owns it.
 *
 * Uses a Lua script for an atomic check-and-delete — without this, worker A
 * could read the key, have its lock expire, and then delete worker B's lock.
 *
 * @param itemId
 * @param token  The same token that was passed to `acquireBidLock`.
 */
export async function releaseBidLock(itemId: string, token: string): Promise<void> {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  await lockRedis.eval(script, 1, lockKey(itemId), token);
}
