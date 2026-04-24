import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod: MongoMemoryServer | MongoMemoryReplSet;

/**
 * Spin up a single-node in-memory MongoDB and connect Mongoose to it.
 * Use for service/integration tests that do NOT use multi-document transactions.
 * Call in `beforeAll`.
 */
export async function connectTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect((mongod as MongoMemoryServer).getUri());
}

/**
 * Spin up a single-node replica set (required for multi-document transactions)
 * and connect Mongoose to it.
 * Use for service tests that call `startSession()` / `withTransaction()`.
 * Call in `beforeAll`.
 */
export async function connectTestDbReplSet(): Promise<void> {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect((mongod as MongoMemoryReplSet).getUri());
}

/**
 * Disconnect Mongoose and stop the in-memory server.
 * Call in `afterAll`.
 */
export async function disconnectTestDb(): Promise<void> {
  await mongoose.disconnect();
  await mongod.stop();
}

/**
 * Wipe every collection between tests.
 * Call in `afterEach` to keep test isolation.
 */
export async function clearTestDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
