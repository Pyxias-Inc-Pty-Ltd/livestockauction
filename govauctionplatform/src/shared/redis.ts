import IORedis from 'ioredis';
import { REDIS_HOST, REDIS_PORT, REDIS_PASS } from '../globals';

/**
 * Shared IORedis connection used by BullMQ queues and workers.
 *
 * BullMQ requires maxRetriesPerRequest: null — without it the client throws
 * when a command is retried after a reconnect, causing spurious job failures.
 *
 * This connection must NOT be reused for the @socket.io/redis-emitter — that
 * library publishes to channels and needs its own connection so BullMQ's
 * blocking commands don't starve the pub/sub pipeline.
 */
export const redisConnection = new IORedis({
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASS || undefined,
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});
