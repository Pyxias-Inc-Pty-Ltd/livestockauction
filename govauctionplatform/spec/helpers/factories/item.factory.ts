import { Types } from 'mongoose';
import { IItem } from '../../../src/models/item-model';
import { EItemStatus, EPublishedStatus } from '../../../src/globals';

let seq = 0;

export function buildItem(overrides: Partial<IItem> = {}): Partial<IItem> {
  const n = ++seq;
  const now = Date.now();
  return {
    _id: new Types.ObjectId(),
    formId: new Types.ObjectId(),
    auctionId: new Types.ObjectId(),
    creatorId: new Types.ObjectId(),
    sellerId: new Types.ObjectId(),
    gallery: [],
    title: { en: `Test Item ${n}`, tn: `Test Item ${n}` },
    titleSlug: { en: `test-item-${n}`, tn: `test-item-${n}` },
    description: { en: 'Test description', tn: 'Test description' },
    terms: { en: 'Test terms', tn: 'Test terms' },
    status: EItemStatus.ACTIVE,
    publishedStatus: EPublishedStatus.PUBLISHED,
    startingBid: 500,
    bidIncrement: 100,
    reservePrice: 0,
    isPurchased: false,
    isBidIncrementedManually: false,
    isClosedBidding: false,
    manualBidAmount: 0,
    eligibleBidders: [],
    lotNumber: n,
    startTime: new Date(now - 60_000),
    endTime: new Date(now + 3_600_000),
    version: 0,
    ...overrides,
  } as Partial<IItem>;
}
