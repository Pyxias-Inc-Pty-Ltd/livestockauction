import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { IBid } from '../../../src/models/bid-model';

let seq = 0;

export function buildBid(overrides: Partial<IBid> = {}): Partial<IBid> {
  const n = ++seq;
  return {
    _id: new Types.ObjectId(),
    itemId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    isRetracted: false,
    bidAmount: 1000 * n,
    bidTime: new Date(),
    bidNumber: `B${String(n).padStart(3, '0')}`,
    idempotencyKey: randomUUID(),
    ...overrides,
  } as Partial<IBid>;
}
