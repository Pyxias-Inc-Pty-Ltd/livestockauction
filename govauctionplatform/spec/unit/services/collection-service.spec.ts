/**
 * collection-service unit/integration tests.
 *
 * Uses a single-node MongoMemoryReplSet so that Mongoose multi-document
 * transactions (used by trackCollectionStatus) work correctly.
 *
 * External dependencies mocked:
 *   - axios               — silences email-queue HTTP calls + model post-save hooks
 *   - elasticsearch-service — silences item/auction ES indexing hooks
 *   - item-service        — factory mock (prevents transitive src/index imports)
 *   - auction-service     — factory mock (same reason)
 *   - src/index           — provides firebase stub used in sendCollectionOtp
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('axios', () => {
  const mockMethods = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  // __esModule: true is required so `import * as axios` + esModuleInterop
  // correctly resolves axios.default.post in the service.
  return { __esModule: true, ...mockMethods, default: mockMethods };
});

jest.mock('../../../src/services/elasticsearch-service', () => ({
  esService: {
    indexItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    indexAuction: jest.fn().mockResolvedValue(undefined),
    removeAuction: jest.fn().mockResolvedValue(undefined),
  },
}));

// Factory mocks prevent Jest from executing the real modules — their transitive
// imports chain reaches src/pre-start/index.ts → commandLineArgs, which crashes
// when Jest's own argv is passed.
jest.mock('../../../src/services/item-service', () => ({
  __esModule: true,
  default: { getById: jest.fn() },
}));

jest.mock('../../../src/services/auction-service', () => ({
  __esModule: true,
  default: { getById: jest.fn() },
}));

// Provides the `firebase` import used in sendCollectionOtp for push notifications.
jest.mock('../../../src/index', () => ({
  firebase: {
    messaging: () => ({
      send: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { Collection, ICollection } from '../../../src/models/collection-model';
import { ECollectionStatus, ERefundReason } from '../../../src/globals';
import { ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import collectionService from '../../../src/services/collection-service';
import itemService from '../../../src/services/item-service';
import auctionService from '../../../src/services/auction-service';
import { connectTestDbReplSet, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildItem } from '../../helpers/factories/item.factory';
import { buildAuction } from '../../helpers/factories/auction.factory';
import { buildBidder } from '../../helpers/factories/user.factory';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Replicate collection-service's internal hashOtp for seeding valid hashes. */
function testHashOtp(code: string, itemId: string): string {
  return createHash('sha256').update(`${code}:${itemId}`).digest('hex');
}

/**
 * Insert a Collection document directly via Mongoose model.
 * The default otpCodeHash matches OTP '12345678' for the generated itemId.
 */
async function seedCollection(overrides: Partial<Record<string, any>> = {}): Promise<ICollection> {
  const defaultItemId = new Types.ObjectId();
  const effectiveItemId: Types.ObjectId = overrides.itemId ?? defaultItemId;
  const data: Record<string, any> = {
    itemId: effectiveItemId,
    auctionId: new Types.ObjectId(),
    buyerId: new Types.ObjectId(),
    sellerId: new Types.ObjectId(),
    purchaseTransactionId: new Types.ObjectId(),
    otpCodeHash: testHashOtp('12345678', effectiveItemId.toString()),
    collectionDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
  const col = new Collection(data);
  await col.save();
  return col;
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(connectTestDbReplSet);
afterAll(disconnectTestDb);
afterEach(clearTestDb);
afterEach(() => jest.useRealTimers());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('collection-service', () => {
  // ─── createCollection ──────────────────────────────────────────────────────

  describe('createCollection', () => {
    const itemId = new Types.ObjectId();
    const txId = new Types.ObjectId();
    const buyerId = new Types.ObjectId();

    beforeEach(() => {
      (itemService.getById as jest.Mock).mockResolvedValue(
        buildItem({ _id: itemId, winningBidder: buyerId as any })
      );
      (auctionService.getById as jest.Mock).mockResolvedValue(
        buildAuction({ collectionWindowDays: 3, collectionStartTime: '08:00', collectionEndTime: '17:00' })
      );
    });

    it('creates a collection with AWAITING_COLLECTION status', async () => {
      const { collection } = await collectionService.createCollection(
        itemId.toString(),
        txId.toString()
      );
      expect(collection.status).toBe(ECollectionStatus.AWAITING_COLLECTION);
      expect(collection.itemId.toString()).toBe(itemId.toString());
      expect(collection.buyerId.toString()).toBe(buyerId.toString());
    });

    it('stores the OTP hash, not the plain code; otpCode is 8 digits', async () => {
      const { collection, otpCode } = await collectionService.createCollection(
        itemId.toString(),
        txId.toString()
      );
      expect(otpCode).toMatch(/^\d{8}$/);
      expect(collection.otpCodeHash).not.toBe(otpCode);
      expect(collection.otpCodeHash).toBe(testHashOtp(otpCode, itemId.toString()));
    });

    it('sets the deadline at collectionEndTime on a weekday', async () => {
      const { collection } = await collectionService.createCollection(
        itemId.toString(),
        txId.toString()
      );
      const dl = collection.collectionDeadline;
      expect(dl.getTime()).toBeGreaterThan(Date.now());
      expect(dl.getHours()).toBe(17);
      expect(dl.getMinutes()).toBe(0);
      const dow = dl.getDay();
      expect(dow).toBeGreaterThanOrEqual(1); // Mon
      expect(dow).toBeLessThanOrEqual(5);    // Fri
    });

    it('skips weekends: Friday + 1 working day lands on Monday', async () => {
      // 2026-04-24 is a Friday.
      // doNotFake all timer APIs so MongoDB async I/O is unaffected; only Date is faked.
      jest.useFakeTimers({
        now: new Date('2026-04-24T09:00:00.000Z').getTime(),
        doNotFake: [
          'nextTick', 'queueMicrotask', 'hrtime', 'performance',
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
          'setImmediate', 'clearImmediate',
        ],
      });
      (auctionService.getById as jest.Mock).mockResolvedValue(
        buildAuction({ collectionWindowDays: 1, collectionStartTime: '08:00', collectionEndTime: '16:00' })
      );

      const { collection } = await collectionService.createCollection(
        itemId.toString(),
        txId.toString()
      );
      expect(collection.collectionDeadline.getDay()).toBe(1); // Monday
      expect(collection.collectionDeadline.getHours()).toBe(16);
    });

    it('skips weekends: Friday + 2 working days lands on Tuesday', async () => {
      jest.useFakeTimers({
        now: new Date('2026-04-24T09:00:00.000Z').getTime(),
        doNotFake: [
          'nextTick', 'queueMicrotask', 'hrtime', 'performance',
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
          'setImmediate', 'clearImmediate',
        ],
      });
      (auctionService.getById as jest.Mock).mockResolvedValue(
        buildAuction({ collectionWindowDays: 2, collectionStartTime: '08:00', collectionEndTime: '16:00' })
      );

      const { collection } = await collectionService.createCollection(
        itemId.toString(),
        txId.toString()
      );
      expect(collection.collectionDeadline.getDay()).toBe(2); // Tuesday
    });

    it('throws NotFoundError if item not found', async () => {
      (itemService.getById as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        collectionService.createCollection(itemId.toString(), txId.toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError if auction not found', async () => {
      (auctionService.getById as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        collectionService.createCollection(itemId.toString(), txId.toString())
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── validateCollectionCode ────────────────────────────────────────────────

  describe('validateCollectionCode', () => {
    const OTP = '87654321';
    const actor = buildBidder() as any;

    it('marks status COLLECTED and sets collectedAt on correct OTP', async () => {
      const itemId = new Types.ObjectId();
      await seedCollection({ itemId, otpCodeHash: testHashOtp(OTP, itemId.toString()) });

      const result = await collectionService.validateCollectionCode(actor, {
        itemId: itemId.toString(),
        otpCode: OTP,
      });

      expect(result.status).toBe(ECollectionStatus.COLLECTED);
      expect(result.collectedAt).toBeDefined();
    });

    it('throws NotFoundError if no collection exists for itemId', async () => {
      await expect(
        collectionService.validateCollectionCode(actor, {
          itemId: new Types.ObjectId().toString(),
          otpCode: '00000000',
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if status is not AWAITING_COLLECTION', async () => {
      const itemId = new Types.ObjectId();
      await seedCollection({
        itemId,
        otpCodeHash: testHashOtp(OTP, itemId.toString()),
        status: ECollectionStatus.COLLECTED,
      });

      await expect(
        collectionService.validateCollectionCode(actor, {
          itemId: itemId.toString(),
          otpCode: OTP,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError on wrong OTP', async () => {
      const itemId = new Types.ObjectId();
      await seedCollection({ itemId, otpCodeHash: testHashOtp(OTP, itemId.toString()) });

      await expect(
        collectionService.validateCollectionCode(actor, {
          itemId: itemId.toString(),
          otpCode: '00000000',
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── raiseDispute ──────────────────────────────────────────────────────────

  describe('raiseDispute', () => {
    const admin = buildBidder() as any;

    it('transitions to DISPUTED from AWAITING_COLLECTION', async () => {
      const col = await seedCollection();
      const result = await collectionService.raiseDispute(admin, {
        collectionId: col.id,
        reason: 'Goods damaged',
      });
      expect(result.status).toBe(ECollectionStatus.DISPUTED);
      expect(result.disputeReason).toBe('Goods damaged');
    });

    it('transitions to DISPUTED from COLLECTED', async () => {
      const col = await seedCollection({ status: ECollectionStatus.COLLECTED });
      const result = await collectionService.raiseDispute(admin, {
        collectionId: col.id,
        reason: 'Goods not as described after collection',
      });
      expect(result.status).toBe(ECollectionStatus.DISPUTED);
    });

    it('stores disputeRaisedBy as currentUser._id', async () => {
      const col = await seedCollection();
      const result = await collectionService.raiseDispute(admin, {
        collectionId: col.id,
        reason: 'Test reason',
      });
      expect(result.disputeRaisedBy?.toString()).toBe(admin._id.toString());
    });

    it('throws NotFoundError on invalid MongoId', async () => {
      await expect(
        collectionService.raiseDispute(admin, { collectionId: 'not-a-valid-id', reason: 'Test' })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError if collection not found', async () => {
      await expect(
        collectionService.raiseDispute(admin, {
          collectionId: new Types.ObjectId().toString(),
          reason: 'Test',
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if status is FORFEITED', async () => {
      const col = await seedCollection({ status: ECollectionStatus.FORFEITED });
      await expect(
        collectionService.raiseDispute(admin, { collectionId: col.id, reason: 'Test' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if status is RESOLVED', async () => {
      const col = await seedCollection({ status: ECollectionStatus.RESOLVED });
      await expect(
        collectionService.raiseDispute(admin, { collectionId: col.id, reason: 'Test' })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── resolveDispute ────────────────────────────────────────────────────────

  describe('resolveDispute', () => {
    const admin = buildBidder() as any;

    it('transitions to RESOLVED and sets refundReason', async () => {
      const col = await seedCollection({ status: ECollectionStatus.DISPUTED });
      const result = await collectionService.resolveDispute(admin, { collectionId: col.id });
      expect(result.status).toBe(ECollectionStatus.RESOLVED);
      expect(result.refundReason).toBe(ERefundReason.DISPUTE_RESOLVED);
    });

    it('stores refundTransactionId when provided', async () => {
      const col = await seedCollection({ status: ECollectionStatus.DISPUTED });
      const refundTxId = new Types.ObjectId().toString();
      const result = await collectionService.resolveDispute(admin, {
        collectionId: col.id,
        refundTransactionId: refundTxId,
      });
      expect(result.refundTransactionId?.toString()).toBe(refundTxId);
    });

    it('throws NotFoundError on invalid MongoId', async () => {
      await expect(
        collectionService.resolveDispute(admin, { collectionId: 'bad-id' })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError if collection not found', async () => {
      await expect(
        collectionService.resolveDispute(admin, {
          collectionId: new Types.ObjectId().toString(),
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if status is not DISPUTED', async () => {
      const col = await seedCollection({ status: ECollectionStatus.AWAITING_COLLECTION });
      await expect(
        collectionService.resolveDispute(admin, { collectionId: col.id })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── trackCollectionStatus ─────────────────────────────────────────────────

  describe('trackCollectionStatus', () => {
    it('forfeits AWAITING_COLLECTION records past their deadline', async () => {
      await seedCollection({ collectionDeadline: new Date(Date.now() - 1_000) });
      await collectionService.trackCollectionStatus();
      const col = await Collection.findOne({});
      expect(col?.status).toBe(ECollectionStatus.FORFEITED);
    });

    it('does not forfeit records whose deadline is in the future', async () => {
      await seedCollection({ collectionDeadline: new Date(Date.now() + 86_400_000) });
      await collectionService.trackCollectionStatus();
      const col = await Collection.findOne({});
      expect(col?.status).toBe(ECollectionStatus.AWAITING_COLLECTION);
    });

    it('does not forfeit COLLECTED records even if past deadline', async () => {
      await seedCollection({
        status: ECollectionStatus.COLLECTED,
        collectionDeadline: new Date(Date.now() - 1_000),
      });
      await collectionService.trackCollectionStatus();
      const col = await Collection.findOne({});
      expect(col?.status).toBe(ECollectionStatus.COLLECTED);
    });

    it('does not forfeit DISPUTED records even if past deadline', async () => {
      await seedCollection({
        status: ECollectionStatus.DISPUTED,
        collectionDeadline: new Date(Date.now() - 1_000),
      });
      await collectionService.trackCollectionStatus();
      const col = await Collection.findOne({});
      expect(col?.status).toBe(ECollectionStatus.DISPUTED);
    });

    it('only forfeits overdue records, leaving non-overdue unchanged', async () => {
      await seedCollection({ collectionDeadline: new Date(Date.now() - 1_000) });
      await seedCollection({ collectionDeadline: new Date(Date.now() + 86_400_000) });

      await collectionService.trackCollectionStatus();

      const forfeited = await Collection.find({ status: ECollectionStatus.FORFEITED });
      const awaiting = await Collection.find({ status: ECollectionStatus.AWAITING_COLLECTION });
      expect(forfeited).toHaveLength(1);
      expect(awaiting).toHaveLength(1);
    });
  });

  // ─── getMyCollection ───────────────────────────────────────────────────────

  describe('getMyCollection', () => {
    it('returns the collection if the current user is the buyer', async () => {
      const buyerId = new Types.ObjectId();
      const col = await seedCollection({ buyerId });
      const currentUser = { _id: buyerId, id: buyerId.toString() } as any;

      const result = await collectionService.getMyCollection(currentUser, col.itemId.toString());
      expect(result?.id).toBe(col.id);
    });

    it('returns null if itemId is not a valid MongoId', async () => {
      const currentUser = { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() } as any;
      const result = await collectionService.getMyCollection(currentUser, 'not-an-id');
      expect(result).toBeNull();
    });

    it('returns null if no collection exists for the itemId', async () => {
      const currentUser = { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() } as any;
      const result = await collectionService.getMyCollection(
        currentUser,
        new Types.ObjectId().toString()
      );
      expect(result).toBeNull();
    });

    it('throws ForbiddenError if the current user is not the buyer', async () => {
      const col = await seedCollection({ buyerId: new Types.ObjectId() });
      const otherUser = { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() } as any;

      await expect(
        collectionService.getMyCollection(otherUser, col.itemId.toString())
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── resendCollectionOtp ───────────────────────────────────────────────────

  describe('resendCollectionOtp', () => {
    const mockItemId = new Types.ObjectId();

    beforeEach(() => {
      // resendCollectionOtp calls itemService.getById + auctionService.getById
      // before re-sending the OTP via sendCollectionOtp.
      (itemService.getById as jest.Mock).mockResolvedValue(
        buildItem({ _id: mockItemId, winningBidder: new Types.ObjectId() as any })
      );
      (auctionService.getById as jest.Mock).mockResolvedValue(buildAuction());
    });

    it('generates a new OTP hash and persists it', async () => {
      const buyerId = new Types.ObjectId();
      const col = await seedCollection({ itemId: mockItemId, buyerId });
      const oldHash = col.otpCodeHash;
      const currentUser = { _id: buyerId, id: buyerId.toString() } as any;

      await collectionService.resendCollectionOtp(currentUser, mockItemId.toString());

      const updated = await Collection.findOne({ itemId: mockItemId });
      expect(updated?.otpCodeHash).not.toBe(oldHash);
    });

    it('invalidates the old OTP after resend', async () => {
      const buyerId = new Types.ObjectId();
      const originalOtp = '11111111';
      await seedCollection({
        itemId: mockItemId,
        buyerId,
        otpCodeHash: testHashOtp(originalOtp, mockItemId.toString()),
      });
      const currentUser = { _id: buyerId, id: buyerId.toString() } as any;

      await collectionService.resendCollectionOtp(currentUser, mockItemId.toString());

      // Attempting to validate with the old OTP should now fail
      await expect(
        collectionService.validateCollectionCode(buildBidder() as any, {
          itemId: mockItemId.toString(),
          otpCode: originalOtp,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError on invalid itemId format', async () => {
      const currentUser = { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() } as any;
      await expect(
        collectionService.resendCollectionOtp(currentUser, 'bad-id')
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError if collection not found', async () => {
      const currentUser = { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() } as any;
      await expect(
        collectionService.resendCollectionOtp(currentUser, new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if current user is not the buyer', async () => {
      const col = await seedCollection({ itemId: mockItemId, buyerId: new Types.ObjectId() });
      const otherUser = { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() } as any;
      await expect(
        collectionService.resendCollectionOtp(otherUser, col.itemId.toString())
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if status is not AWAITING_COLLECTION', async () => {
      const buyerId = new Types.ObjectId();
      await seedCollection({
        itemId: mockItemId,
        buyerId,
        status: ECollectionStatus.COLLECTED,
      });
      const currentUser = { _id: buyerId, id: buyerId.toString() } as any;
      await expect(
        collectionService.resendCollectionOtp(currentUser, mockItemId.toString())
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── getCollections ────────────────────────────────────────────────────────

  describe('getCollections', () => {
    it('returns all collections with default pagination', async () => {
      await seedCollection();
      await seedCollection();
      const results = await collectionService.getCollections(new Map());
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('throws ForbiddenError if limit exceeds 100', async () => {
      await expect(
        collectionService.getCollections(new Map([['limit', 101]]))
      ).rejects.toThrow(ForbiddenError);
    });

    it('filters by status', async () => {
      await seedCollection({ status: ECollectionStatus.AWAITING_COLLECTION });
      await seedCollection({ status: ECollectionStatus.COLLECTED });

      const results = await collectionService.getCollections(
        new Map([['status', ECollectionStatus.COLLECTED]])
      );
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(ECollectionStatus.COLLECTED);
    });

    it('filters by buyerId', async () => {
      const buyerId = new Types.ObjectId();
      await seedCollection({ buyerId });
      await seedCollection(); // different buyerId

      const results = await collectionService.getCollections(
        new Map([['buyerId', buyerId]])
      );
      expect(results).toHaveLength(1);
      expect(results[0].buyerId.toString()).toBe(buyerId.toString());
    });
  });
});
