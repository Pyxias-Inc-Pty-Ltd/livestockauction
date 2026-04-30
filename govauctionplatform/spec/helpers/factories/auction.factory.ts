import { Types } from 'mongoose';
import { IAuction } from '../../../src/models/auction-model';
import {
  EAuctionStatus,
  EPublishedStatus,
  EParticipationType,
  ESectorType,
} from '../../../src/globals';

let seq = 0;

export function buildAuction(overrides: Partial<IAuction> = {}): Partial<IAuction> {
  const n = ++seq;
  return {
    _id: new Types.ObjectId(),
    title: { en: `Test Auction ${n}`, tn: `Test Auction ${n}` },
    titleSlug: { en: `test-auction-${n}`, tn: `test-auction-${n}` },
    isInviteOnly: false,
    auctionNumber: `A2026042${String(n).padStart(3, '0')}`,
    auctionLocation: 'Test Location',
    sectorType: ESectorType.GOVERNMENT,
    numberOfLots: 1,
    hasRegistrationFee: false,
    requiredAttributes: [],
    participantsWithBiddingNumbers: [],
    globallyEligibleBidders: [],
    creatorId: new Types.ObjectId(),
    categoryId: new Types.ObjectId(),
    participationType: EParticipationType.EVERYONE,
    terms: { en: 'Test Terms', tn: 'Test Terms' },
    startTime: new Date(Date.now() - 60_000),   // started 1 min ago
    endTime: new Date(Date.now() + 3_600_000),  // ends in 1 hour
    status: EAuctionStatus.ACTIVE,
    publishedStatus: EPublishedStatus.PUBLISHED,
    isBeingLivestreamed: false,
    streamUrl: '',
    collectionWindowDays: 5,
    collectionStartTime: '08:00',
    collectionEndTime: '16:00',
    ...overrides,
  } as Partial<IAuction>;
}
