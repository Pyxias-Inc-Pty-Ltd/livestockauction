/**
 * bid-service unit/integration tests.
 *
 * Uses a single-node MongoMemoryReplSet so that Mongoose multi-document
 * transactions (startSession / withTransaction) work correctly.
 *
 * External service dependencies are mocked at the module level:
 *   - axios          — silences model post-save hooks that call the queue service
 *   - elasticsearch-service — silences item/auction ES indexing hooks
 *   - item-service   — mocked for updateItemWithBid and getById
 *   - auction-service — mocked for getById
 *   - bid-event-model — silences fire-and-forget audit writes
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('axios', () => {
  const mockMethods = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  // __esModule: true is required so that `import * as axios` + esModuleInterop
  // leaves the mock object intact and `axios.default.post` resolves correctly.
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

// Factory mocks prevent Jest from executing the real modules (and their transitive
// imports — e.g. auction-service → forum-service → forum-model → src/index.ts —
// which would trigger commandLineArgs with Jest's argv and crash the suite).
jest.mock('../../../src/services/item-service', () => ({
  __esModule: true,
  default: {
    updateItemWithBid: jest.fn(),
    getById: jest.fn(),
  },
}));

jest.mock('../../../src/services/auction-service', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
  },
}));

jest.mock('../../../src/models/bid-event-model', () => ({
  BidEvent: { create: jest.fn().mockResolvedValue({}) },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { Bid } from '../../../src/models/bid-model';
import { Item } from '../../../src/models/item-model';
import { Bidder } from '../../../src/models/user-model';
import {
  EItemStatus,
  EIdentityNumberVerificationStatus,
  EParticipationType,
  FLOOR_BID_USER_ID,
} from '../../../src/globals';
import { ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { encryptBidAmount } from '../../../src/shared/bid-crypto';
import bidService from '../../../src/services/bid-service';
import itemService from '../../../src/services/item-service';
import auctionService from '../../../src/services/auction-service';
import { connectTestDbReplSet, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildBidder } from '../../helpers/factories/user.factory';
import { buildItem } from '../../helpers/factories/item.factory';
import { buildAuction } from '../../helpers/factories/auction.factory';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Configure the auction mock for the current test. */
function mockAuction(overrides: Record<string, unknown> = {}) {
  (auctionService.getById as jest.Mock).mockResolvedValue(
    buildAuction({ participationType: EParticipationType.EVERYONE, ...overrides }),
  );
}

/** Make itemService.updateItemWithBid return the given value (default: true). */
function mockItemUpdate(returns = true) {
  (itemService.updateItemWithBid as jest.Mock).mockResolvedValue(returns);
}

/**
 * Build an in-memory Bidder Mongoose document (not saved to DB).
 * Avoids triggering the post-save email/identity-verification hooks
 * while still providing a proper Mongoose doc with `.id` virtual.
 */
function seedBidder(overrides: Record<string, unknown> = {}) {
  return new Bidder(
    buildBidder({
      identityNumberVerificationStatus: EIdentityNumberVerificationStatus.VERIFIED,
      ...overrides,
    }),
  );
}

/**
 * Insert an item directly via the raw collection driver, bypassing all
 * Mongoose pre/post-save hooks (which require a real Auction in the DB).
 * Returns the full Mongoose document via findById so callers get virtuals.
 */
async function seedItem(
  bidderId: Types.ObjectId | string,
  overrides: Record<string, unknown> = {},
) {
  const data = buildItem({
    eligibleBidders: [bidderId.toString()],
    ...overrides,
  }) as Record<string, unknown>;

  await Item.collection.insertOne(data);
  // We just inserted the doc so findById will always succeed here
  return (await Item.findById(data._id as Types.ObjectId))!;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('bid-service', () => {
  beforeAll(async () => {
    await connectTestDbReplSet();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuction();
    mockItemUpdate();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createOpenBid — Mode 1
  // ───────────────────────────────────────────────────────────────────────────

  describe('createOpenBid', () => {
    it('saves and returns the bid on the happy path', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { startingBid: 500 });

      const bid = await bidService.createOpenBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 600,
        bidTime: new Date(),
      });

      expect(bid.bidAmount).toBe(600);
      expect(bid.isRetracted).toBe(false);
      expect(bid.bidAmountEncrypted).toBeUndefined();

      const persisted = await Bid.findById(bid._id);
      expect(persisted).not.toBeNull();
    });

    it('returns the existing bid for a duplicate idempotency key', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);
      const idempotencyKey = randomUUID();
      const input = {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 600,
        bidTime: new Date(),
        idempotencyKey,
      };

      const first = await bidService.createOpenBid(bidder as any, input);
      const second = await bidService.createOpenBid(bidder as any, input);

      expect(second._id.toString()).toBe(first._id.toString());
      expect(await Bid.countDocuments({ idempotencyKey })).toBe(1);
    });

    it('rejects a bidder not in eligibleBidders when auction is invite-only', async () => {
      mockAuction({ isInviteOnly: true });

      const bidder = await seedBidder();
      const item = await seedItem(new Types.ObjectId()); // different bidder

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows a bidder who has paid the reserve to bid on a non-invite-only auction', async () => {
      const bidder = await seedBidder();
      // seedItem adds bidder._id to eligibleBidders by default (simulates paid reservation)
      const item = await seedItem(bidder._id);

      const bid = await bidService.createOpenBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 600,
        bidTime: new Date(),
      });

      expect(bid.bidAmount).toBe(600);
    });

    it('rejects when item status is NOT_BEGUN', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { status: EItemStatus.NOT_BEGUN });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is ENDED', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { status: EItemStatus.ENDED });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is CANCELLED', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { status: EItemStatus.CANCELLED });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when endTime has passed even if status is still ACTIVE', async () => {
      // Simulates the up-to-59 s window between lot endTime and the cron closing it.
      // The endTime guard must stop bids immediately regardless of DB status.
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        status: EItemStatus.ACTIVE,
        endTime: new Date(Date.now() - 1_000), // 1 s in the past
      });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects bid amount strictly below startingBid', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { startingBid: 500 });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 499,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects bid amount at or below currentBid', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { startingBid: 500, currentBid: 800 });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 700,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects bid that does not meet the minimum increment on a consecutive bid', async () => {
      const bidder = await seedBidder();
      // Seed item with currentBid=700 (simulates a prior accepted bid).
      // Next bid must be at least 700 + 200 = 900, so 800 is rejected.
      const item = await seedItem(bidder._id, { startingBid: 500, bidIncrement: 200, currentBid: 700 });

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 800,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects an organisation bidder in a CITIZEN_ONLY auction', async () => {
      mockAuction({ participationType: EParticipationType.CITIZEN_ONLY });
      const bidder = await seedBidder({ isOrganization: true });
      const item = await seedItem(bidder._id);

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects a bidder with unverified identity', async () => {
      const bidder = await seedBidder({
        identityNumberVerificationStatus: EIdentityNumberVerificationStatus.PENDING,
      });
      const item = await seedItem(bidder._id);

      await expect(
        bidService.createOpenBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('closes the item immediately when buyoutPrice is met', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        startingBid: 500,
        bidIncrement: 100,
        buyoutPrice: 1000,
      });

      await bidService.createOpenBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 1000,
        bidTime: new Date(),
      });

      const updated = await Item.findById(item._id);
      expect(updated?.status).toBe(EItemStatus.ENDED);
      expect(updated?.winningBidder?.toString()).toBe(bidder._id.toString());
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createLivestreamBid — Mode 2
  // ───────────────────────────────────────────────────────────────────────────

  describe('createLivestreamBid', () => {
    it('saves bid when amount equals manualBidAmount and does NOT mutate the item', async () => {
      const itemUpdateSpy = jest.spyOn(Item, 'updateOne');

      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
      });

      const bid = await bidService.createLivestreamBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 750,
        bidTime: new Date(),
      });

      expect(bid.bidAmount).toBe(750);

      // The redesigned function saves only a Bid document — item must not be mutated.
      expect(itemUpdateSpy).not.toHaveBeenCalled();

      itemUpdateSpy.mockRestore();
    });

    it('accepts bid amount above manualBidAmount', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
      });

      const bid = await bidService.createLivestreamBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 800,
        bidTime: new Date(),
      });

      expect(bid.bidAmount).toBe(800);
    });

    it('rejects when amount is below manualBidAmount', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
      });

      await expect(
        bidService.createLivestreamBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 700,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects a bidder not eligible for the lot', async () => {
      mockAuction({ isInviteOnly: true });

      const bidder = await seedBidder();
      const item = await seedItem(new Types.ObjectId(), { // different bidder in eligibleBidders
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
      });

      await expect(
        bidService.createLivestreamBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 750,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is NOT_BEGUN', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
        status: EItemStatus.NOT_BEGUN,
      });

      await expect(
        bidService.createLivestreamBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 750,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is ENDED', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
        status: EItemStatus.ENDED,
      });

      await expect(
        bidService.createLivestreamBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 750,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('two concurrent bids for the same lot both resolve (no lock contention)', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
        // Both bidders eligible
        eligibleBidders: [bidder1._id.toString(), bidder2._id.toString()],
      });

      const [bid1, bid2] = await Promise.all([
        bidService.createLivestreamBid(bidder1 as any, {
          itemId: item._id,
          userId: bidder1._id,
          bidAmount: 750,
          bidTime: new Date(),
        }),
        bidService.createLivestreamBid(bidder2 as any, {
          itemId: item._id,
          userId: bidder2._id,
          bidAmount: 750,
          bidTime: new Date(),
        }),
      ]);

      expect(bid1.bidAmount).toBe(750);
      expect(bid2.bidAmount).toBe(750);

      const count = await Bid.countDocuments({ itemId: item._id, isRetracted: false });
      expect(count).toBe(2);
    });

    it('returns existing bid for duplicate idempotency key', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
        manualBidAmount: 750,
      });
      const idempotencyKey = randomUUID();
      const input = {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 750,
        bidTime: new Date(),
        idempotencyKey,
      };

      const first = await bidService.createLivestreamBid(bidder as any, input);
      const second = await bidService.createLivestreamBid(bidder as any, input);

      expect(second._id.toString()).toBe(first._id.toString());
      expect(await Bid.countDocuments({ idempotencyKey })).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createSealedBid — Mode 3
  // ───────────────────────────────────────────────────────────────────────────

  describe('createSealedBid', () => {
    it('stores bidAmount=0 with bidAmountEncrypted set', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isClosedBidding: true,
        bidIncrement: undefined,
        startingBid: 500,
      });

      const bid = await bidService.createSealedBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 700,
        bidTime: new Date(),
      });

      expect(bid.bidAmount).toBe(0);
      expect(bid.bidAmountEncrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    });

    it('rejects a second bid from the same bidder (submit-once)', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isClosedBidding: true,
        bidIncrement: undefined,
        startingBid: 500,
      });
      const base = {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 700,
        bidTime: new Date(),
      };

      await bidService.createSealedBid(bidder as any, base);

      await expect(
        bidService.createSealedBid(bidder as any, { ...base, idempotencyKey: undefined }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects bid amount strictly below startingBid', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isClosedBidding: true,
        bidIncrement: undefined,
        startingBid: 500,
      });

      await expect(
        bidService.createSealedBid(bidder as any, {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 499,
          bidTime: new Date(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows bid amount equal to startingBid', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isClosedBidding: true,
        bidIncrement: undefined,
        startingBid: 500,
      });

      const bid = await bidService.createSealedBid(bidder as any, {
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 500,
        bidTime: new Date(),
      });

      expect(bid.bidAmountEncrypted).toBeTruthy();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // retractBid
  // ───────────────────────────────────────────────────────────────────────────

  describe('retractBid', () => {
    it('marks the bid isRetracted=true for Mode 1 while item is ACTIVE', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);
      const savedBid = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 600,
        bidTime: new Date(),
        isRetracted: false,
      });

      const result = await bidService.retractBid(bidder as any, savedBid._id);
      expect(result.isRetracted).toBe(true);

      const dbBid = await Bid.findById(savedBid._id);
      expect(dbBid?.isRetracted).toBe(true);
    });

    it('rejects retraction on a Mode 2 (livestream) item', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isBidIncrementedManually: true,
        bidIncrement: undefined,
      });
      const savedBid = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 750,
        bidTime: new Date(),
        isRetracted: false,
      });

      await expect(
        bidService.retractBid(bidder as any, savedBid._id),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects retraction on a Mode 3 (sealed) item', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, {
        isClosedBidding: true,
        bidIncrement: undefined,
      });
      const savedBid = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 0,
        bidTime: new Date(),
        isRetracted: false,
      });

      await expect(
        bidService.retractBid(bidder as any, savedBid._id),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects retraction when item is ENDED', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id, { status: EItemStatus.ENDED });
      const savedBid = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 600,
        bidTime: new Date(),
        isRetracted: false,
      });

      await expect(
        bidService.retractBid(bidder as any, savedBid._id),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects retraction by a different user (bid not found)', async () => {
      const owner = await seedBidder();
      const other = await seedBidder();
      const item = await seedItem(owner._id);
      const savedBid = await Bid.create({
        itemId: item._id,
        userId: owner._id,
        bidAmount: 600,
        bidTime: new Date(),
        isRetracted: false,
      });

      await expect(
        bidService.retractBid(other as any, savedBid._id),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects retraction of an already-retracted bid', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);
      const savedBid = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 600,
        bidTime: new Date(),
        isRetracted: true,
      });

      await expect(
        bidService.retractBid(bidder as any, savedBid._id),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // decryptSealedBids
  // ───────────────────────────────────────────────────────────────────────────

  describe('decryptSealedBids', () => {
    it('restores plaintext bidAmount and clears bidAmountEncrypted', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);
      const sealed = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 0,
        bidAmountEncrypted: encryptBidAmount(1234),
        bidTime: new Date(),
        isRetracted: false,
      });

      await bidService.decryptSealedBids(item._id.toString());

      const updated = await Bid.findById(sealed._id);
      expect(updated?.bidAmount).toBe(1234);
      expect(updated?.bidAmountEncrypted).toBeUndefined();
    });

    it('leaves bids with no bidAmountEncrypted unchanged', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);
      const plain = await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 999,
        bidTime: new Date(),
        isRetracted: false,
      });

      await bidService.decryptSealedBids(item._id.toString());

      const unchanged = await Bid.findById(plain._id);
      expect(unchanged?.bidAmount).toBe(999);
    });

    it('decrypts multiple sealed bids in one call', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id);

      await Bid.create([
        {
          itemId: item._id,
          userId: bidder1._id,
          bidAmount: 0,
          bidAmountEncrypted: encryptBidAmount(2000),
          bidTime: new Date(),
          isRetracted: false,
        },
        {
          itemId: item._id,
          userId: bidder2._id,
          bidAmount: 0,
          bidAmountEncrypted: encryptBidAmount(3000),
          bidTime: new Date(),
          isRetracted: false,
        },
      ]);

      await bidService.decryptSealedBids(item._id.toString());

      const bids = await Bid.find({ itemId: item._id }).sort({ bidAmount: 1 });
      expect(bids[0].bidAmount).toBe(2000);
      expect(bids[1].bidAmount).toBe(3000);
      expect(bids[0].bidAmountEncrypted).toBeUndefined();
      expect(bids[1].bidAmountEncrypted).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // getBids
  // ───────────────────────────────────────────────────────────────────────────

  describe('getBids', () => {
    beforeEach(() => {
      (itemService.getById as jest.Mock).mockResolvedValue(
        buildItem({ isClosedBidding: false, status: EItemStatus.ACTIVE }),
      );
      (auctionService.getById as jest.Mock).mockResolvedValue(
        buildAuction({ participantsWithBiddingNumbers: [] }),
      );
    });

    it('returns only non-retracted bids for an open item', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);
      await Bid.create([
        {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 600,
          bidTime: new Date(),
          isRetracted: false,
        },
        {
          itemId: item._id,
          userId: bidder._id,
          bidAmount: 700,
          bidTime: new Date(),
          isRetracted: true,
        },
      ]);

      const bids = await bidService.getBids(item._id.toString(), new Map());
      expect(bids).toHaveLength(1);
      expect(bids[0].bidAmount).toBe(600);
    });

    it('returns only the caller own bid for a sealed ACTIVE item', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id);

      (itemService.getById as jest.Mock).mockResolvedValue(
        buildItem({ isClosedBidding: true, status: EItemStatus.ACTIVE }),
      );

      await Bid.create([
        {
          itemId: item._id,
          userId: bidder1._id,
          bidAmount: 0,
          bidTime: new Date(),
          isRetracted: false,
        },
        {
          itemId: item._id,
          userId: bidder2._id,
          bidAmount: 0,
          bidTime: new Date(),
          isRetracted: false,
        },
      ]);

      const conditions = new Map([['callerId', bidder1._id.toString()]]);
      const bids = await bidService.getBids(item._id.toString(), conditions);
      expect(bids).toHaveLength(1);
      expect(bids[0].userId.toString()).toBe(bidder1._id.toString());
    });

    it('returns empty array for sealed ACTIVE when callerId is missing', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);

      (itemService.getById as jest.Mock).mockResolvedValue(
        buildItem({ isClosedBidding: true, status: EItemStatus.ACTIVE }),
      );

      await Bid.create({
        itemId: item._id,
        userId: bidder._id,
        bidAmount: 0,
        bidTime: new Date(),
        isRetracted: false,
      });

      const bids = await bidService.getBids(item._id.toString(), new Map());
      expect(bids).toHaveLength(0);
    });

    it('returns all bids for a sealed ENDED item (auction closed, reveal)', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id);

      (itemService.getById as jest.Mock).mockResolvedValue(
        buildItem({ isClosedBidding: true, status: EItemStatus.ENDED }),
      );

      await Bid.create([
        {
          itemId: item._id,
          userId: bidder1._id,
          bidAmount: 1000,
          bidTime: new Date(),
          isRetracted: false,
        },
        {
          itemId: item._id,
          userId: bidder2._id,
          bidAmount: 1200,
          bidTime: new Date(),
          isRetracted: false,
        },
      ]);

      const bids = await bidService.getBids(item._id.toString(), new Map());
      expect(bids).toHaveLength(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // getWinningBid
  // ───────────────────────────────────────────────────────────────────────────

  describe('getWinningBid', () => {
    it('returns the bid with the highest amount', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id);

      await Bid.create([
        { itemId: item._id, userId: bidder1._id, bidAmount: 500, bidTime: new Date(), isRetracted: false },
        { itemId: item._id, userId: bidder2._id, bidAmount: 800, bidTime: new Date(), isRetracted: false },
      ]);

      const winner = await bidService.getWinningBid(item._id.toString());
      expect(winner?.bidAmount).toBe(800);
      expect(winner?.userId.toString()).toBe(bidder2._id.toString());
    });

    it('returns null when there are no bids', async () => {
      const bidder = await seedBidder();
      const item = await seedItem(bidder._id);

      const winner = await bidService.getWinningBid(item._id.toString());
      expect(winner).toBeNull();
    });

    it('ignores retracted bids when finding the winner', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id);

      await Bid.create([
        { itemId: item._id, userId: bidder1._id, bidAmount: 1000, bidTime: new Date(), isRetracted: true },
        { itemId: item._id, userId: bidder2._id, bidAmount: 700, bidTime: new Date(), isRetracted: false },
      ]);

      const winner = await bidService.getWinningBid(item._id.toString());
      expect(winner?.bidAmount).toBe(700);
      expect(winner?.userId.toString()).toBe(bidder2._id.toString());
    });

    it('breaks a tie by earliest bidTime — first bidder wins', async () => {
      const bidder1 = await seedBidder();
      const bidder2 = await seedBidder();
      const item = await seedItem(bidder1._id);

      const earlier = new Date('2025-01-01T10:00:00Z');
      const later   = new Date('2025-01-01T10:00:01Z');

      await Bid.create([
        { itemId: item._id, userId: bidder2._id, bidAmount: 500, bidTime: later,   isRetracted: false },
        { itemId: item._id, userId: bidder1._id, bidAmount: 500, bidTime: earlier, isRetracted: false },
      ]);

      const winner = await bidService.getWinningBid(item._id.toString());
      expect(winner?.userId.toString()).toBe(bidder1._id.toString());
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createFloorBid — Floor bid (hybrid floor + online bidding)
  // ───────────────────────────────────────────────────────────────────────────

  describe('createFloorBid', () => {
    it('saves a floor bid under the FLOOR_BID_USER_ID sentinel', async () => {
      const item = await seedItem(new Types.ObjectId(), {
        isBidIncrementedManually: true,
        manualBidAmount: 500,
      });

      const result = await bidService.createFloorBid(
        { id: 'clerk-id' } as any,
        { itemId: item._id.toString(), bidAmount: 500 },
      );

      expect(result).not.toBeNull();
      expect(result!.userId.toString()).toBe(FLOOR_BID_USER_ID);
      expect(result!.bidAmount).toBe(500);
      expect(result!.isRetracted).toBe(false);
    });

    it('is idempotent — second call at same price returns null', async () => {
      const item = await seedItem(new Types.ObjectId(), {
        isBidIncrementedManually: true,
        manualBidAmount: 700,
      });
      const input = { itemId: item._id.toString(), bidAmount: 700 };

      const first = await bidService.createFloorBid({ id: 'clerk' } as any, input);
      const second = await bidService.createFloorBid({ id: 'clerk' } as any, input);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      // Only one floor bid document persisted
      const count = await Bid.countDocuments({
        userId: FLOOR_BID_USER_ID,
        itemId: item._id,
        bidAmount: 700,
      });
      expect(count).toBe(1);
    });

    it('rejects when the auction is NOT livestream (isBidIncrementedManually=false)', async () => {
      const item = await seedItem(new Types.ObjectId(), {
        isBidIncrementedManually: false,
      });

      await expect(
        bidService.createFloorBid(
          { id: 'clerk' } as any,
          { itemId: item._id.toString(), bidAmount: 500 },
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is NOT_BEGUN', async () => {
      const item = await seedItem(new Types.ObjectId(), {
        isBidIncrementedManually: true,
        status: EItemStatus.NOT_BEGUN,
      });

      await expect(
        bidService.createFloorBid(
          { id: 'clerk' } as any,
          { itemId: item._id.toString(), bidAmount: 500 },
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is ENDED', async () => {
      const item = await seedItem(new Types.ObjectId(), {
        isBidIncrementedManually: true,
        status: EItemStatus.ENDED,
      });

      await expect(
        bidService.createFloorBid(
          { id: 'clerk' } as any,
          { itemId: item._id.toString(), bidAmount: 500 },
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects when item status is CANCELLED', async () => {
      const item = await seedItem(new Types.ObjectId(), {
        isBidIncrementedManually: true,
        status: EItemStatus.CANCELLED,
      });

      await expect(
        bidService.createFloorBid(
          { id: 'clerk' } as any,
          { itemId: item._id.toString(), bidAmount: 500 },
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError for a nonexistent itemId', async () => {
      await expect(
        bidService.createFloorBid(
          { id: 'clerk' } as any,
          { itemId: new Types.ObjectId().toString(), bidAmount: 500 },
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
