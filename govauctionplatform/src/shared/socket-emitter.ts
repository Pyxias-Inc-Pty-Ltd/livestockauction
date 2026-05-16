import IORedis from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import { REDIS_HOST, REDIS_PORT, REDIS_PASS } from '../globals';

/**
 * Dedicated IORedis connection for the Socket.io Redis emitter.
 *
 * Must be separate from the BullMQ `redisConnection` — BullMQ uses blocking
 * commands (BRPOP, XREAD) that would starve the pub/sub pipeline if shared.
 */
const emitterRedis = new IORedis({
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASS || undefined,
  maxRetriesPerRequest: null,
});

emitterRedis.on('error', (err) => {
  console.error('[socket-emitter] Redis connection error:', err.message);
});

/**
 * Redis-backed Socket.io emitter.
 *
 * Use this instead of the local `io` Server instance in workers and background
 * processes.  The emitter publishes events to the Redis pub/sub channel that
 * the `@socket.io/redis-adapter` (attached to every server instance) subscribes
 * to — so events reach clients regardless of which instance they are connected to.
 */
export const socketEmitter = new Emitter(emitterRedis);
