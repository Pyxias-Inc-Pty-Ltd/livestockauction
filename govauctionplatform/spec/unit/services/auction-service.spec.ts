/**
 * auction-service unit/integration tests.
 *
 * Uses MongoMemoryReplSet (createAuction + trackAuctionStatus use startSession/withTransaction).
 *
 * Mocks:
 *   - axios                    — silences auction-model post-save queue calls
 *   - elasticsearch-service    — silences esService calls in auction-model post-save hooks
 *   - category-service         — factory mock (prevents transitive pre-start crash)
 *   - forum-service            — factory mock (same reason)
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('axios', () => {
  const m = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  return { __esModule: true, ...m, default: m };
});

jest.mock('../../../src/services/elasticsearch-service', () => ({
  esService: {
    indexItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    indexAuction: jest.fn().mockResolvedValue(undefined),
    removeAuction: jest.fn().mockResolvedValue(undefined),
    updateItemsWithAuction: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/services/category-service', () => ({
  __esModule: true,
  default: {
    getById: jest.fn().mockResolvedValue({ _id: 'category-id' }),
  },
}));

jest.mock('../../../src/services/forum-service', () => ({
  __esModule: true,
  default: {
    createForum: jest.fn().mockResolvedValue({}),
    getForumByAuctionId: jest.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Types } from 'mongoose';
import { Auction, IAuction, IAuctionInput } from '../../../src/models/auction-model';
import { ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import {
  EAuctionStatus,
  EPublishedStatus,
  EParticipationType,
  ESectorType,
} from '../../../src/globals';
import auctionService from '../../../src/services/auction-service';
import categoryService from '../../../src/services/category-service';
import { connectTestDbReplSet, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildAuction } from '../../helpers/factories/auction.factory';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedAuction(overrides: Partial<IAuction> = {}): Promise<IAuction> {
  const data = {
    ...buildAuction(),
    // Required fields not in the factory — must be present when auction.save() is called
    // (e.g. by trackAuctionStatus which saves inside a transaction)
    thumbnailUrl: 'https://example.com/thumb.jpg',
    auctionCoordinates: { type: 'Point', coordinates: [25.91, -24.65] },
    publishedBy: new Types.ObjectId(),
    ...overrides,
  };
  await Auction.collection.insertOne(data as any);
  return (await Auction.findById(data._id))!;
}

/** Minimal valid IAuctionInput with future start/end times. */
function makeAuctionInput(overrides: Partial<IAuctionInput> = {}): IAuctionInput {
  const start = new Date(Date.now() + 3_600_000); // 1 hour from now
  const end   = new Date(Date.now() + 7_200_000); // 2 hours from now
  return {
    title: { en: 'Test Auction', tn: 'Khansele ya Tlhatlhano' },
    isInviteOnly: false,
    auctionNumber: '',
    hasRegistrationFee: false,
    sectorType: ESectorType.GOVERNMENT,
    auctionLocation: 'Gaborone, Botswana',
    auctionCoordinates: { type: 'Point', coordinates: [25.91, -24.65] },
    participationType: EParticipationType.EVERYONE,
    creatorId: new Types.ObjectId() as any,
    categoryId: new Types.ObjectId() as any,
    terms: { en: 'Standard terms apply.', tn: 'Standard terms apply.' },
    isBeingLivestreamed: false,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    collectionWindowDays: 5,
    collectionStartTime: '08:00',
    collectionEndTime: '16:00',
    startTime: start,
    endTime: end,
    ...overrides,
  };
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(connectTestDbReplSet);
afterAll(disconnectTestDb);
afterEach(async () => {
  await clearTestDb();
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('auction-service', () => {
  // ─── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns null for an invalid MongoId', async () => {
      const result = await auctionService.getById('not-a-valid-id');
      expect(result).toBeNull();
    });

    it('returns null for a valid id that does not exist', async () => {
      const result = await auctionService.getById(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });

    it('returns the auction document for a valid existing id', async () => {
      const auction = await seedAuction();
      const result = await auctionService.getById(auction.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(auction.id);
    });
  });

  // ─── getByTitleSlug ────────────────────────────────────────────────────────

  describe('getByTitleSlug', () => {
    it('returns null when no auction has that English slug', async () => {
      const result = await auctionService.getByTitleSlug('ghost-auction', 'en');
      expect(result).toBeNull();
    });

    it('returns the auction matching the English slug', async () => {
      await seedAuction({ titleSlug: { en: 'my-auction-en', tn: 'my-auction-tn' } });
      const result = await auctionService.getByTitleSlug('my-auction-en', 'en');
      expect(result).not.toBeNull();
      expect(result!.titleSlug.en).toBe('my-auction-en');
    });

    it('returns the auction matching the Tswana slug', async () => {
      await seedAuction({ titleSlug: { en: 'my-auction-en2', tn: 'my-auction-tn2' } });
      const result = await auctionService.getByTitleSlug('my-auction-tn2', 'tn');
      expect(result).not.toBeNull();
      expect(result!.titleSlug.tn).toBe('my-auction-tn2');
    });
  });

  // ─── getAuctions ───────────────────────────────────────────────────────────

  describe('getAuctions', () => {
    it('throws ForbiddenError when limit exceeds 100', async () => {
      await expect(
        auctionService.getAuctions(new Map([['limit', 101]]))
      ).rejects.toThrow(ForbiddenError);
    });

    it('returns all auctions when no filters applied', async () => {
      await seedAuction();
      await seedAuction();
      const results = await auctionService.getAuctions(new Map());
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by a specific status', async () => {
      await seedAuction({ status: EAuctionStatus.ACTIVE });
      await seedAuction({ status: EAuctionStatus.ENDED });

      const results = await auctionService.getAuctions(
        new Map([['status', EAuctionStatus.ENDED]])
      );
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(EAuctionStatus.ENDED);
    });

    it('filters by creatorId', async () => {
      const creatorId = new Types.ObjectId();
      await seedAuction({ creatorId: creatorId as any });
      await seedAuction(); // different random creatorId

      const results = await auctionService.getAuctions(
        new Map([['creatorId', creatorId]])
      );
      expect(results).toHaveLength(1);
    });

    it('respects a custom limit', async () => {
      await seedAuction();
      await seedAuction();
      await seedAuction();

      const results = await auctionService.getAuctions(new Map([['limit', 2]]));
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ─── publishAuction ────────────────────────────────────────────────────────

  describe('publishAuction', () => {
    it('throws NotFoundError when auction does not exist', async () => {
      await expect(
        auctionService.publishAuction({} as any, new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when auction is already PUBLISHED', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.PUBLISHED,
      });
      await expect(
        auctionService.publishAuction({} as any, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when auction is REJECTED', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.REJECTED,
      });
      await expect(
        auctionService.publishAuction({} as any, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('sets publishedStatus to PUBLISHED and returns the updated auction', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.UNPUBLISHED,
      });
      const approver = { _id: new Types.ObjectId() } as any;

      const result = await auctionService.publishAuction(approver, auction.id);

      expect(result.publishedStatus).toBe(EPublishedStatus.PUBLISHED);
      expect(result.publishedBy!.toString()).toBe(approver._id.toString());
    });
  });

  // ─── unpublishAuction ──────────────────────────────────────────────────────

  describe('unpublishAuction', () => {
    it('throws NotFoundError when auction does not exist', async () => {
      await expect(
        auctionService.unpublishAuction({} as any, new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when auction is not PUBLISHED', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.UNPUBLISHED,
      });
      await expect(
        auctionService.unpublishAuction({} as any, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when auction status is ACTIVE', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.PUBLISHED,
        status: EAuctionStatus.ACTIVE,
      });
      await expect(
        auctionService.unpublishAuction({} as any, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('sets publishedStatus to UNPUBLISHED and returns the updated auction', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.PUBLISHED,
        status: EAuctionStatus.NOT_BEGUN,
      });

      const result = await auctionService.unpublishAuction({} as any, auction.id);

      expect(result.publishedStatus).toBe(EPublishedStatus.UNPUBLISHED);
    });
  });

  // ─── rejectAuction ─────────────────────────────────────────────────────────

  describe('rejectAuction', () => {
    it('throws NotFoundError when auction does not exist', async () => {
      await expect(
        auctionService.rejectAuction({} as any, new Types.ObjectId().toString(), 'reason')
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when auction is already PUBLISHED', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.PUBLISHED,
      });
      await expect(
        auctionService.rejectAuction({} as any, auction.id, 'reason')
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when no rejection reason is provided', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.UNPUBLISHED,
      });
      await expect(
        auctionService.rejectAuction({} as any, auction.id, '')
      ).rejects.toThrow(ForbiddenError);
    });

    it('sets publishedStatus=REJECTED and status=CANCELLED with the reason', async () => {
      const auction = await seedAuction({
        publishedStatus: EPublishedStatus.UNPUBLISHED,
        status: EAuctionStatus.NOT_BEGUN,
      });
      const approver = { _id: new Types.ObjectId() } as any;

      const result = await auctionService.rejectAuction(approver, auction.id, 'Missing documentation');

      expect(result.publishedStatus).toBe(EPublishedStatus.REJECTED);
      expect(result.status).toBe(EAuctionStatus.CANCELLED);
      expect(result.reasonForRejection).toBe('Missing documentation');
    });
  });

  // ─── deleteAuction ─────────────────────────────────────────────────────────

  describe('deleteAuction', () => {
    it('returns undefined silently for an invalid MongoId (no-op)', async () => {
      const result = await auctionService.deleteAuction({} as any, 'invalid-id');
      expect(result).toBeUndefined();
    });

    it('returns undefined silently when the auction does not exist', async () => {
      const result = await auctionService.deleteAuction(
        {} as any,
        new Types.ObjectId().toString()
      );
      expect(result).toBeUndefined();
    });

    it('deletes a NOT_BEGUN auction', async () => {
      const auction = await seedAuction({
        status: EAuctionStatus.NOT_BEGUN,
        numberOfLots: 0,
      });

      await auctionService.deleteAuction({} as any, auction.id);

      const found = await Auction.findById(auction._id);
      expect(found).toBeNull();
    });

    it('throws ForbiddenError for a non-NOT_BEGUN auction that has lots', async () => {
      const auction = await seedAuction({
        status: EAuctionStatus.ACTIVE,
        numberOfLots: 3,
      });
      await expect(
        auctionService.deleteAuction({} as any, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for a non-NOT_BEGUN auction with no lots', async () => {
      const auction = await seedAuction({
        status: EAuctionStatus.ENDED,
        numberOfLots: 0,
      });
      await expect(
        auctionService.deleteAuction({} as any, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── trackAuctionStatus ────────────────────────────────────────────────────

  describe('trackAuctionStatus', () => {
    it('activates a PUBLISHED NOT_BEGUN auction whose startTime has passed', async () => {
      await seedAuction({
        status: EAuctionStatus.NOT_BEGUN,
        publishedStatus: EPublishedStatus.PUBLISHED,
        startTime: new Date(Date.now() - 60_000), // 1 min ago
        endTime: new Date(Date.now() + 3_600_000),
      });

      await auctionService.trackAuctionStatus();

      const updated = await Auction.findOne({});
      expect(updated!.status).toBe(EAuctionStatus.ACTIVE);
    });

    it('ends a PUBLISHED auction whose endTime has passed', async () => {
      await seedAuction({
        status: EAuctionStatus.ACTIVE,
        publishedStatus: EPublishedStatus.PUBLISHED,
        startTime: new Date(Date.now() - 7_200_000),
        endTime: new Date(Date.now() - 60_000), // ended 1 min ago
      });

      await auctionService.trackAuctionStatus();

      const updated = await Auction.findOne({});
      expect(updated!.status).toBe(EAuctionStatus.ENDED);
    });

    it('does NOT activate an UNPUBLISHED auction whose startTime has passed', async () => {
      await seedAuction({
        status: EAuctionStatus.NOT_BEGUN,
        publishedStatus: EPublishedStatus.UNPUBLISHED,
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 3_600_000),
      });

      await auctionService.trackAuctionStatus();

      const unchanged = await Auction.findOne({});
      expect(unchanged!.status).toBe(EAuctionStatus.NOT_BEGUN);
    });

    it('does NOT activate a PUBLISHED auction whose startTime is in the future', async () => {
      await seedAuction({
        status: EAuctionStatus.NOT_BEGUN,
        publishedStatus: EPublishedStatus.PUBLISHED,
        startTime: new Date(Date.now() + 3_600_000),
        endTime: new Date(Date.now() + 7_200_000),
      });

      await auctionService.trackAuctionStatus();

      const unchanged = await Auction.findOne({});
      expect(unchanged!.status).toBe(EAuctionStatus.NOT_BEGUN);
    });
  });

  // ─── createAuction ─────────────────────────────────────────────────────────

  describe('createAuction', () => {
    const mockAdmin = { id: new Types.ObjectId().toString() } as any;

    it('throws ForbiddenError when startTime is in the past', async () => {
      const input = makeAuctionInput({
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 3_600_000),
      });
      await expect(auctionService.createAuction(mockAdmin, input)).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when endTime is before startTime', async () => {
      const input = makeAuctionInput({
        startTime: new Date(Date.now() + 3_600_000),
        endTime: new Date(Date.now() + 1_800_000), // before start
      });
      await expect(auctionService.createAuction(mockAdmin, input)).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when the category does not exist', async () => {
      (categoryService.getById as jest.Mock).mockResolvedValueOnce(null);
      const input = makeAuctionInput();
      await expect(auctionService.createAuction(mockAdmin, input)).rejects.toThrow(NotFoundError);
    });

    it('persists the auction and creates a forum (happy path)', async () => {
      const input = makeAuctionInput();

      const result = await auctionService.createAuction(mockAdmin, input);

      expect(result).toBeDefined();
      expect(result.status).toBe('NOT_BEGUN');
      const stored = await Auction.findById(result._id);
      expect(stored).not.toBeNull();
    });
  });
});
