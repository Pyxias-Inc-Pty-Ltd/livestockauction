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

// transaction-model.ts imports `{ firebase } from '../index'` at the module
// level, so we must mock src/index before any transaction-model import resolves.
jest.mock('../../../src/index', () => ({
  firebase: {
    messaging: () => ({ send: jest.fn().mockResolvedValue(undefined) }),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Types } from 'mongoose';
import { Auction, IAuction, IAuctionInput } from '../../../src/models/auction-model';
import { ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import {
  EAuctionStatus,
  EAttachmentType,
  EPublishedStatus,
  EParticipationType,
  ESectorType,
  EStreamProvider,
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

/** A Form Gen 60 attachment subdocument (authorization-to-auction form). */
function makeGen60Attachment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'Form Gen 60 - Authorization.pdf',
    url: 'https://example.com/files/form-gen-60.pdf',
    type: EAttachmentType.FORM_GEN_60,
    uploadedBy: new Types.ObjectId(),
    uploadedAt: new Date(),
    ...overrides,
  };
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
    isClosedBidding: false,
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

    // The public slug route passes `{ streamKey: 0 }`. Without the control below, the
    // exclusion test would pass against an auction that simply had no key stored — the
    // assertion could not exhibit the difference it names.
    it('omits streamKey when the caller passes an exclusion projection', async () => {
      await seedAuction({
        titleSlug: { en: 'projected-auction', tn: 'projected-auction' },
        streamKey: 'auc-abcdef0123456789abcdef0123456789',
      });
      const result = await auctionService.getByTitleSlug('projected-auction', 'en', {
        streamKey: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.streamKey).toBeUndefined();
      // The rest of the document still comes back — the projection is exclusion-only.
      expect(result!.titleSlug.en).toBe('projected-auction');
    });

    it('returns streamKey when no projection is given', async () => {
      await seedAuction({
        titleSlug: { en: 'unprojected-auction', tn: 'unprojected-auction' },
        streamKey: 'auc-abcdef0123456789abcdef0123456789',
      });
      const result = await auctionService.getByTitleSlug('unprojected-auction', 'en');
      expect(result).not.toBeNull();
      expect(result!.streamKey).toBe('auc-abcdef0123456789abcdef0123456789');
    });
  });

  // ─── getAuctions ───────────────────────────────────────────────────────────

  describe('getAuctions', () => {
    it('throws ForbiddenError when limit exceeds 100', async () => {
      await expect(
        auctionService.getAuctions(new Map([['limit', 101]]))
      ).rejects.toThrow(ForbiddenError);
    });

    // The public list route passes `{ streamKey: 0 }` for the same reason the slug route does.
    // The control below is what makes the exclusion test non-vacuous: without it, the
    // assertion would pass against auctions that simply had no key stored.
    it('omits streamKey when the caller passes an exclusion projection', async () => {
      await seedAuction({ streamKey: 'auc-abcdef0123456789abcdef0123456789' });
      const results = await auctionService.getAuctions(new Map(), { streamKey: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].streamKey).toBeUndefined();
    });

    it('returns streamKey when no projection is given', async () => {
      await seedAuction({ streamKey: 'auc-abcdef0123456789abcdef0123456789' });
      const results = await auctionService.getAuctions(new Map());
      expect(results).toHaveLength(1);
      expect(results[0].streamKey).toBe('auc-abcdef0123456789abcdef0123456789');
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

    it('throws ForbiddenError when publishing a GOVERNMENT auction without a Form Gen 60 attachment', async () => {
      const auction = await seedAuction({
        sectorType: ESectorType.GOVERNMENT,
        publishedStatus: EPublishedStatus.UNPUBLISHED,
      });
      const approver = { _id: new Types.ObjectId() } as any;

      await expect(
        auctionService.publishAuction(approver, auction.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('publishes a GOVERNMENT auction that has a Form Gen 60 attachment', async () => {
      const auction = await seedAuction({
        sectorType: ESectorType.GOVERNMENT,
        publishedStatus: EPublishedStatus.UNPUBLISHED,
        attachments: [makeGen60Attachment()] as any,
      });
      const approver = { _id: new Types.ObjectId() } as any;

      const result = await auctionService.publishAuction(approver, auction.id);

      expect(result.publishedStatus).toBe(EPublishedStatus.PUBLISHED);
      expect(result.publishedBy!.toString()).toBe(approver._id.toString());
    });

    it('publishes a PRIVATE auction without a Form Gen 60 attachment', async () => {
      const auction = await seedAuction({
        sectorType: ESectorType.PRIVATE,
        publishedStatus: EPublishedStatus.UNPUBLISHED,
      });
      const approver = { _id: new Types.ObjectId() } as any;

      const result = await auctionService.publishAuction(approver, auction.id);

      expect(result.publishedStatus).toBe(EPublishedStatus.PUBLISHED);
    });
  });

  // ─── attachments (Form Gen 60) ────────────────────────────────────────────

  describe('addAttachment', () => {
    const approverId = new Types.ObjectId() as any;

    it('throws ForbiddenError for an invalid auctionId', async () => {
      await expect(
        auctionService.addAttachment('not-a-valid-id', makeGen60Attachment(), approverId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when the auction does not exist', async () => {
      await expect(
        auctionService.addAttachment(
          new Types.ObjectId().toString(),
          makeGen60Attachment(),
          approverId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('adds an attachment and returns the updated list', async () => {
      const auction = await seedAuction();

      const result = await auctionService.addAttachment(
        auction.id,
        makeGen60Attachment(),
        approverId
      );

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(EAttachmentType.FORM_GEN_60);
      expect(result[0].uploadedBy.toString()).toBe(approverId.toString());

      const stored = await Auction.findById(auction._id);
      expect(stored!.attachments).toHaveLength(1);
    });
  });

  describe('removeAttachment', () => {
    it('throws ForbiddenError for an invalid auctionId', async () => {
      await expect(
        auctionService.removeAttachment('not-a-valid-id', new Types.ObjectId().toString())
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when the auction does not exist', async () => {
      await expect(
        auctionService.removeAttachment(
          new Types.ObjectId().toString(),
          new Types.ObjectId().toString()
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('removes the matching attachment and returns the remaining list', async () => {
      const first = makeGen60Attachment();
      const second = makeGen60Attachment({ name: 'Second.pdf', url: 'https://example.com/second.pdf' });
      const auction = await seedAuction({
        attachments: [first, second] as any,
      });
      const targetId = (first as any)._id.toString();

      const result = await auctionService.removeAttachment(auction.id, targetId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Second.pdf');

      const stored = await Auction.findById(auction._id);
      expect(stored!.attachments).toHaveLength(1);
    });
  });

  describe('getAttachments', () => {
    it('throws ForbiddenError for an invalid auctionId', async () => {
      await expect(auctionService.getAttachments('not-a-valid-id')).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when the auction does not exist', async () => {
      await expect(
        auctionService.getAttachments(new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('returns the attachments for an existing auction', async () => {
      const auction = await seedAuction({
        attachments: [makeGen60Attachment()] as any,
      });

      const result = await auctionService.getAttachments(auction.id);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(EAttachmentType.FORM_GEN_60);
    });

    it('returns an empty array when the auction has no attachments', async () => {
      const auction = await seedAuction();

      const result = await auctionService.getAttachments(auction.id);

      expect(result).toEqual([]);
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

    // ── streamKey generation ────────────────────────────────────────────────
    // The stream identity only matters for our own media server; an embed auction must not
    // grow one. These assert the persisted document, not just the returned value, because
    // that is what a later phase would read.

    it('generates a streamKey for a media-server livestream', async () => {
      const input = makeAuctionInput({
        isBeingLivestreamed: true,
        streamProvider: EStreamProvider.MEDIA_SERVER,
      });

      const result = await auctionService.createAuction(mockAdmin, input);

      const stored = await Auction.findById(result._id);
      expect(stored?.streamKey).toMatch(/^auc-[0-9a-f]{32}$/);
    });

    it('does not generate a streamKey for an embed livestream', async () => {
      const input = makeAuctionInput({
        isBeingLivestreamed: true,
        streamProvider: EStreamProvider.EMBED,
        streamUrl: 'https://youtube.com/live/abc',
      });

      const result = await auctionService.createAuction(mockAdmin, input);

      const stored = await Auction.findById(result._id);
      expect(stored?.streamKey).toBeUndefined();
    });

    it('does not generate a streamKey when the auction is not livestreamed', async () => {
      const input = makeAuctionInput({
        isBeingLivestreamed: false,
        streamProvider: EStreamProvider.MEDIA_SERVER,
      });

      const result = await auctionService.createAuction(mockAdmin, input);

      const stored = await Auction.findById(result._id);
      expect(stored?.streamKey).toBeUndefined();
    });

    it('drops a client-supplied streamKey on the embed path', async () => {
      // The embed path is where the delete is the *only* defence: no key is minted here, so
      // nothing would overwrite a caller-chosen value. Route through the embed path for that
      // reason — a media-server-path version of this test passes with or without the delete, because
      // the mint covers for it, and so tests nothing about the guard.
      const input = makeAuctionInput({
        isBeingLivestreamed: true,
        streamProvider: EStreamProvider.EMBED,
        streamUrl: 'https://youtube.com/live/abc',
        streamKey: 'auc-client-chosen',
      } as any);

      const result = await auctionService.createAuction(mockAdmin, input);

      const stored = await Auction.findById(result._id);
      expect(stored?.streamProvider).toBe(EStreamProvider.EMBED);
      expect(stored?.streamKey).toBeUndefined();
    });
  });

  // ─── Model-level regression guard for existing (embed) auctions ────────────
  //
  // The media-server path must not weaken the rule that every pre-existing livestreamed auction
  // obeys: a livestream needs a streamUrl unless it is on our own media server. Checked at
  // the model, because the model — not Joi — is what rejects the save.

  describe('auction model — streamUrl requirement survives the media-server branch', () => {
    /** A document that satisfies every other model requirement, so the only possible
     *  validation failure is the streamUrl rule under test. */
    function documentFor(overrides: Partial<IAuction>) {
      return {
        ...buildAuction(),
        thumbnailUrl: 'https://example.com/thumb.jpg',
        auctionCoordinates: { type: 'Point', coordinates: [25.91, -24.65] },
        publishedBy: new Types.ObjectId(),
        ...overrides,
      } as any;
    }

    it('still rejects a livestreamed auction with no streamUrl and no provider', async () => {
      // No streamProvider written => the schema default makes this an embed auction, so the
      // old requirement applies exactly as it did before this change.
      await expect(Auction.create(documentFor({
        isBeingLivestreamed: true,
        streamUrl: undefined,
        streamProvider: undefined,
      } as Partial<IAuction>))).rejects.toThrow(/streamUrl/);
    });

    it('accepts a livestreamed embed auction that supplies a streamUrl', async () => {
      await expect(Auction.create(documentFor({
        isBeingLivestreamed: true,
        streamUrl: 'https://youtube.com/live/abc',
        streamProvider: EStreamProvider.EMBED,
      } as Partial<IAuction>))).resolves.toBeDefined();
    });

    it('accepts a livestreamed media-server auction with no streamUrl', async () => {
      await expect(Auction.create(documentFor({
        isBeingLivestreamed: true,
        streamUrl: undefined,
        streamProvider: EStreamProvider.MEDIA_SERVER,
        streamKey: 'auc-abcdef0123456789abcdef0123456789',
      } as Partial<IAuction>))).resolves.toBeDefined();
    });

    it('accepts a non-livestreamed auction with no streamUrl', async () => {
      await expect(Auction.create(documentFor({
        isBeingLivestreamed: false,
        streamUrl: undefined,
      } as Partial<IAuction>))).resolves.toBeDefined();
    });
  });

  // ─── updateAuction: streamKey invariant ───────────────────────────────────

  describe('updateAuction — streamKey invariant', () => {
    /** An editable (unpublished) auction owned by the caller. */
    async function seedEditableAuction(overrides: Partial<IAuction> = {}) {
      const creatorId = new Types.ObjectId();
      const data = {
        ...buildAuction(),
        thumbnailUrl: 'https://example.com/thumb.jpg',
        auctionCoordinates: { type: 'Point', coordinates: [25.91, -24.65] },
        creatorId,
        publishedStatus: EPublishedStatus.UNPUBLISHED,
        isBeingLivestreamed: false,
        streamProvider: EStreamProvider.EMBED,
        ...overrides,
      };
      // insertOne matches the house pattern here, and deliberately bypasses the schema so a
      // fixture can hold a state the model would reject (e.g. a hand-written streamKey).
      await Auction.collection.insertOne(data as any);
      const seeded = (await Auction.findById(data._id))!;
      return { auction: seeded, seller: { _id: creatorId } as any };
    }

    it('mints a streamKey when an existing auction is switched to the media server', async () => {
      // The defect this guards: findByIdAndUpdate runs no validators, so without explicit
      // handling here the auction persists as media-server + livestreamed with no stream identity.
      const { auction, seller } = await seedEditableAuction();

      await auctionService.updateAuction(seller, auction._id.toString(), {
        streamProvider: EStreamProvider.MEDIA_SERVER,
        isBeingLivestreamed: true,
      } as Partial<IAuctionInput>);

      const stored = await Auction.findById(auction._id);
      expect(stored?.isBeingLivestreamed).toBe(true);
      expect(stored?.streamProvider).toBe(EStreamProvider.MEDIA_SERVER);
      expect(stored?.streamKey).toMatch(/^auc-[0-9a-f]{32}$/);
    });

    it('mints a streamKey when an already-livestreamed auction switches to the media server', async () => {
      // Same invariant reached by a different route: provider changed, livestream flag
      // left alone, so the effective state must be read from the stored auction.
      const { auction, seller } = await seedEditableAuction({ isBeingLivestreamed: true });

      await auctionService.updateAuction(seller, auction._id.toString(), {
        streamProvider: EStreamProvider.MEDIA_SERVER,
      } as Partial<IAuctionInput>);

      const stored = await Auction.findById(auction._id);
      expect(stored?.streamKey).toMatch(/^auc-[0-9a-f]{32}$/);
    });

    it('preserves an existing streamKey instead of rotating it', async () => {
      // Rotating would invalidate the ingest URL already configured in the seller's encoder
      // and cut a live stream, so an edit must not touch it.
      const { auction, seller } = await seedEditableAuction({
        isBeingLivestreamed: true,
        streamProvider: EStreamProvider.MEDIA_SERVER,
        streamKey: 'auc-existingkey00000000000000000000',
      });

      await auctionService.updateAuction(seller, auction._id.toString(), {
        auctionLocation: 'Francistown',
      } as Partial<IAuctionInput>);

      const stored = await Auction.findById(auction._id);
      expect(stored?.streamKey).toBe('auc-existingkey00000000000000000000');
    });

    it('does not mint a streamKey for an embed auction', async () => {
      const { auction, seller } = await seedEditableAuction();

      await auctionService.updateAuction(seller, auction._id.toString(), {
        isBeingLivestreamed: true,
        streamProvider: EStreamProvider.EMBED,
        streamUrl: 'https://youtube.com/live/abc',
      } as Partial<IAuctionInput>);

      const stored = await Auction.findById(auction._id);
      expect(stored?.streamKey).toBeUndefined();
    });

    it('does not mint a streamKey when switching to the media server but not livestreaming', async () => {
      const { auction, seller } = await seedEditableAuction();

      await auctionService.updateAuction(seller, auction._id.toString(), {
        streamProvider: EStreamProvider.MEDIA_SERVER,
        isBeingLivestreamed: false,
      } as Partial<IAuctionInput>);

      const stored = await Auction.findById(auction._id);
      expect(stored?.streamKey).toBeUndefined();
    });

    it('does not let a client-supplied streamKey overwrite an existing one', async () => {
      // The mint is conditional on there being no key, so for an auction that already has one
      // the delete is the only thing between `input` spread into `$set` and a caller rewriting
      // a live stream's identity. The earlier version of this test used a key-less auction,
      // where the mint overwrote the client value and the assertion passed either way.
      const { auction, seller } = await seedEditableAuction({
        isBeingLivestreamed: true,
        streamProvider: EStreamProvider.MEDIA_SERVER,
        streamKey: 'auc-existingkey00000000000000000000',
      });

      await auctionService.updateAuction(seller, auction._id.toString(), {
        streamKey: 'auc-client-chosen',
      } as any);

      const stored = await Auction.findById(auction._id);
      expect(stored?.streamKey).toBe('auc-existingkey00000000000000000000');
    });
  });
});
