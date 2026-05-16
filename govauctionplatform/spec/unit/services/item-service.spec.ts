/**
 * item-service unit/integration tests.
 *
 * Uses MongoMemoryReplSet (createItem + trackItemStatus use startSession/withTransaction).
 *
 * Mocks:
 *   - elasticsearch-service   — silences esService calls in item-model post-save hooks
 *   - auction-service         — factory mock (prevents transitive pre-start crash)
 *   - bid-service             — factory mock (same reason)
 *   - category-service        — factory mock (same reason)
 *
 * Note: the livestock path in createItem (BAITS EID lookup) is not tested here;
 *       all createItem tests use non-livestock items (metadata.isLivestock = false).
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('../../../src/services/elasticsearch-service', () => ({
  esService: {
    indexItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    indexAuction: jest.fn().mockResolvedValue(undefined),
    removeAuction: jest.fn().mockResolvedValue(undefined),
    updateItemsWithAuction: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/services/auction-service', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
  },
}));

jest.mock('../../../src/services/bid-service', () => ({
  __esModule: true,
  default: {
    getWinningBid: jest.fn(),
    decryptSealedBids: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/services/category-service', () => ({
  __esModule: true,
  default: { getById: jest.fn() },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Types } from 'mongoose';
import { Item, IItem, IItemInput } from '../../../src/models/item-model';
import '../../../src/models/form-model';    // register Form model so populate doesn't throw
import '../../../src/models/user-model';   // register Bidder model for getEligibleBidders
import '../../../src/models/auction-model'; // register Auction model (item pre-save hook queries it)
import { ForbiddenError, InternalServerError, NotFoundError } from '../../../src/shared/errors';
import { EItemStatus, EPublishedStatus } from '../../../src/globals';
import itemService from '../../../src/services/item-service';
import auctionService from '../../../src/services/auction-service';
import bidService from '../../../src/services/bid-service';
import { connectTestDbReplSet, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildItem } from '../../helpers/factories/item.factory';
import { Auction } from '../../../src/models/auction-model';
import { buildAuction } from '../../helpers/factories/auction.factory';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedItem(overrides: Partial<IItem> = {}): Promise<IItem> {
  const data = {
    ...buildItem(),
    metadata: { isLivestock: false },
    ...overrides,
  };
  await Item.collection.insertOne(data as any);
  return (await Item.findById(data._id))!;
}

/** Minimal valid IItemInput for createItem (non-livestock).
 *  Cast to any first to allow formId which is required in the schema but absent from IItemInput type. */
function makeItemInput(auctionId: Types.ObjectId, overrides: Partial<Record<string, any>> = {}): IItemInput {
  const start = new Date(Date.now() + 3_600_000);
  const end   = new Date(Date.now() + 7_200_000);
  return {
    auctionId: auctionId as any,
    formId: new Types.ObjectId() as any, // required by Item schema but missing from IItemInput type
    sellerId: new Types.ObjectId() as any,
    creatorId: new Types.ObjectId() as any,
    categoryId: new Types.ObjectId() as any,
    gallery: [],
    title: { en: 'Test Item', tn: 'Test Item' },
    description: { en: 'A test item.', tn: 'A test item.' },
    terms: { en: 'Standard terms.', tn: 'Standard terms.' },
    startingBid: 500,
    bidIncrement: 100,
    reservePrice: 0,
    isBidIncrementedManually: false,
    isClosedBidding: false,
    status: 'NOT_BEGUN',
    startTime: start,
    endTime: end,
    metadata: { isLivestock: false },
    ...overrides,
  } as unknown as IItemInput;
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(connectTestDbReplSet);
afterAll(disconnectTestDb);
afterEach(async () => {
  await clearTestDb();
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('item-service', () => {
  // ─── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns null for an invalid MongoId', async () => {
      const result = await itemService.getById('not-a-valid-id');
      expect(result).toBeNull();
    });

    it('returns the item document for a valid existing id', async () => {
      const item = await seedItem();
      const result = await itemService.getById(item.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(item.id);
    });
  });

  // ─── getByTitleSlug ────────────────────────────────────────────────────────

  describe('getByTitleSlug', () => {
    it('returns null when no item has that English slug', async () => {
      const result = await itemService.getByTitleSlug('ghost-item', 'en');
      expect(result).toBeNull();
    });

    it('returns the item matching the English slug', async () => {
      await seedItem({ titleSlug: { en: 'my-item-en', tn: 'my-item-tn' } });
      const result = await itemService.getByTitleSlug('my-item-en', 'en');
      expect(result!.titleSlug.en).toBe('my-item-en');
    });

    it('returns the item matching the Tswana slug', async () => {
      await seedItem({ titleSlug: { en: 'my-item-en2', tn: 'my-item-tn2' } });
      const result = await itemService.getByTitleSlug('my-item-tn2', 'tn');
      expect(result!.titleSlug.tn).toBe('my-item-tn2');
    });
  });

  // ─── getItems ──────────────────────────────────────────────────────────────

  describe('getItems', () => {
    it('throws ForbiddenError when limit exceeds 100', async () => {
      await expect(
        itemService.getItems(new Map([['limit', 101]]))
      ).rejects.toThrow(ForbiddenError);
    });

    it('returns items when no filters applied', async () => {
      await seedItem();
      await seedItem();
      const results = await itemService.getItems(new Map());
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by auctionId', async () => {
      const auctionId = new Types.ObjectId();
      await seedItem({ auctionId: auctionId as any });
      await seedItem(); // different auctionId

      const results = await itemService.getItems(new Map([['auctionId', auctionId]]));
      expect(results).toHaveLength(1);
    });

    it('filters by status', async () => {
      await seedItem({ status: EItemStatus.ENDED });
      await seedItem({ status: EItemStatus.ACTIVE });

      const results = await itemService.getItems(new Map([['status', EItemStatus.ENDED]]));
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(EItemStatus.ENDED);
    });
  });

  // ─── getItemsWon ───────────────────────────────────────────────────────────

  describe('getItemsWon', () => {
    it('returns only ENDED items where winningBidder matches the current user', async () => {
      const bidderId = new Types.ObjectId();
      await seedItem({ status: EItemStatus.ENDED, winningBidder: bidderId as any });
      await seedItem({ status: EItemStatus.ENDED }); // different winningBidder

      const bidder = { id: bidderId.toString() } as any;
      const results = await itemService.getItemsWon(bidder, new Map());
      expect(results).toHaveLength(1);
    });

    it('excludes ACTIVE items even if winningBidder matches', async () => {
      const bidderId = new Types.ObjectId();
      await seedItem({ status: EItemStatus.ACTIVE, winningBidder: bidderId as any });

      const bidder = { id: bidderId.toString() } as any;
      const results = await itemService.getItemsWon(bidder, new Map());
      expect(results).toHaveLength(0);
    });
  });

  // ─── deleteItem ────────────────────────────────────────────────────────────

  describe('deleteItem', () => {
    it('returns undefined silently for an invalid MongoId', async () => {
      const result = await itemService.deleteItem({} as any, 'not-a-valid-id');
      expect(result).toBeUndefined();
    });

    it('returns undefined silently when item does not exist', async () => {
      const result = await itemService.deleteItem({} as any, new Types.ObjectId().toString());
      expect(result).toBeUndefined();
    });

    it('deletes a NOT_BEGUN item', async () => {
      const item = await seedItem({ status: EItemStatus.NOT_BEGUN });
      await itemService.deleteItem({} as any, item.id);
      const found = await Item.findById(item._id);
      expect(found).toBeNull();
    });

    it('throws ForbiddenError for a non-NOT_BEGUN item', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE });
      await expect(
        itemService.deleteItem({} as any, item.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── setNewBidAmountManually ───────────────────────────────────────────────

  describe('setNewBidAmountManually', () => {
    it('throws NotFoundError when item does not exist', async () => {
      await expect(
        itemService.setNewBidAmountManually({ itemId: new Types.ObjectId().toString(), amount: 1000 })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when item is not manually incremented', async () => {
      const item = await seedItem({ isBidIncrementedManually: false });
      await expect(
        itemService.setNewBidAmountManually({ itemId: item.id, amount: 1000 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('updates manualBidAmount on the item', async () => {
      const item = await seedItem({ isBidIncrementedManually: true, manualBidAmount: 0 });
      const result = await itemService.setNewBidAmountManually({ itemId: item.id, amount: 2500 });
      expect(result.manualBidAmount).toBe(2500);
    });
  });

  // ─── getManualBidAmount ────────────────────────────────────────────────────

  describe('getManualBidAmount', () => {
    it('throws NotFoundError when item does not exist', async () => {
      await expect(
        itemService.getManualBidAmount(new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('returns manualBidAmount for an existing item', async () => {
      const item = await seedItem({ manualBidAmount: 750 });
      const result = await itemService.getManualBidAmount(item.id);
      expect(result).toBe(750);
    });
  });

  // ─── setWinningBidder ──────────────────────────────────────────────────────

  describe('setWinningBidder', () => {
    it('throws NotFoundError when item does not exist', async () => {
      await expect(
        itemService.setWinningBidder({ itemId: new Types.ObjectId().toString(), bidderId: new Types.ObjectId().toString() })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when item is not ENDED', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE });
      await expect(
        itemService.setWinningBidder({ itemId: item.id, bidderId: new Types.ObjectId().toString() })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when bidder is not in eligibleBidders', async () => {
      const item = await seedItem({ status: EItemStatus.ENDED, eligibleBidders: [] });
      await expect(
        itemService.setWinningBidder({ itemId: item.id, bidderId: new Types.ObjectId().toString() })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws InternalServerError when no winning bid exists', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() })
      ).rejects.toThrow(InternalServerError);
    });

    it('throws ForbiddenError when winning bid belongs to a different bidder', async () => {
      const bidderId = new Types.ObjectId();
      const otherBidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: otherBidderId,
        bidAmount: 1000,
      });

      await expect(
        itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() })
      ).rejects.toThrow(ForbiddenError);
    });

    it('sets winningBidder when the bidder holds the highest bid', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: bidderId,
        bidAmount: 1000,
      });

      const result = await itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() });
      expect(result.winningBidder!.toString()).toBe(bidderId.toString());
    });
  });

  // ─── autoSelectWinner ──────────────────────────────────────────────────────

  describe('autoSelectWinner', () => {
    it('returns null when item does not exist', async () => {
      const result = await itemService.autoSelectWinner(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });

    it('returns the item unchanged if winningBidder is already set (idempotent)', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        winningBidder: bidderId as any,
      });

      const result = await itemService.autoSelectWinner(item.id);
      expect(result!.winningBidder!.toString()).toBe(bidderId.toString());
      expect(bidService.getWinningBid).not.toHaveBeenCalled();
    });

    it('returns item unchanged when no bids exist (lot goes unsold)', async () => {
      const item = await seedItem({ status: EItemStatus.ENDED });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce(null);

      const result = await itemService.autoSelectWinner(item.id);
      expect(result!.winningBidder).toBeFalsy();
    });

    it('does not assign winner when winning bid is below the reserve price', async () => {
      const item = await seedItem({ status: EItemStatus.ENDED, reservePrice: 1000 });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: new Types.ObjectId(),
        bidAmount: 500, // below reserve
      });

      const result = await itemService.autoSelectWinner(item.id);
      expect(result!.winningBidder).toBeFalsy();
    });

    it('sets winningBidder when winning bid meets or exceeds reserve price', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({ status: EItemStatus.ENDED, reservePrice: 500 });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: bidderId,
        bidAmount: 600,
      });

      const result = await itemService.autoSelectWinner(item.id);
      expect(result!.winningBidder!.toString()).toBe(bidderId.toString());
    });
  });

  // ─── trackItemStatus ───────────────────────────────────────────────────────

  describe('trackItemStatus', () => {
    it('activates a NOT_BEGUN item whose startTime has passed', async () => {
      await seedItem({
        status: EItemStatus.NOT_BEGUN,
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 3_600_000),
      });

      await itemService.trackItemStatus();

      const updated = await Item.findOne({});
      expect(updated!.status).toBe(EItemStatus.ACTIVE);
    });

    it('ends an ACTIVE item whose endTime has passed', async () => {
      await seedItem({
        status: EItemStatus.ACTIVE,
        startTime: new Date(Date.now() - 7_200_000),
        endTime: new Date(Date.now() - 60_000),
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValue(null);

      await itemService.trackItemStatus();

      const updated = await Item.findOne({});
      expect(updated!.status).toBe(EItemStatus.ENDED);
    });

    it('calls decryptSealedBids for sealed items that just ended', async () => {
      await seedItem({
        status: EItemStatus.ACTIVE,
        isClosedBidding: true,
        startTime: new Date(Date.now() - 7_200_000),
        endTime: new Date(Date.now() - 60_000),
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValue(null);

      await itemService.trackItemStatus();

      expect(bidService.decryptSealedBids).toHaveBeenCalled();
    });

    it('does NOT activate a NOT_BEGUN item whose startTime is in the future', async () => {
      await seedItem({
        status: EItemStatus.NOT_BEGUN,
        startTime: new Date(Date.now() + 3_600_000),
        endTime: new Date(Date.now() + 7_200_000),
      });

      await itemService.trackItemStatus();

      const unchanged = await Item.findOne({});
      expect(unchanged!.status).toBe(EItemStatus.NOT_BEGUN);
    });
  });

  // ─── getItemsWithWinnerForRefund ───────────────────────────────────────────

  describe('getItemsWithWinnerForRefund', () => {
    it('returns ENDED items that have a winningBidder set', async () => {
      const bidderId = new Types.ObjectId();
      await seedItem({ status: EItemStatus.ENDED, winningBidder: bidderId as any });
      await seedItem({ status: EItemStatus.ENDED }); // no winningBidder

      const results = await itemService.getItemsWithWinnerForRefund();
      expect(results).toHaveLength(1);
    });

    it('excludes items without a winningBidder', async () => {
      await seedItem({ status: EItemStatus.ENDED }); // no winner
      const results = await itemService.getItemsWithWinnerForRefund();
      expect(results).toHaveLength(0);
    });
  });

  // ─── createItem ────────────────────────────────────────────────────────────

  describe('createItem', () => {
    const mockAdmin = { id: new Types.ObjectId().toString() } as any;

    /** Seed a real auction in the DB and wire auctionService.getById to return it. */
    async function seedAndMockAuction(statusOverride = 'NOT_BEGUN') {
      const auctionData = {
        ...buildAuction({ status: statusOverride as any }),
        thumbnailUrl: 'https://example.com/thumb.jpg',
        auctionCoordinates: { type: 'Point', coordinates: [25.91, -24.65] },
        publishedBy: new Types.ObjectId(),
        globallyEligibleBidders: [],
        numberOfLots: 0,
      };
      await Auction.collection.insertOne(auctionData as any);
      const dbAuction = (await Auction.findById(auctionData._id))!;
      (auctionService.getById as jest.Mock).mockResolvedValue(dbAuction);
      return dbAuction;
    }

    it('throws ForbiddenError when startTime is in the past', async () => {
      const auction = await seedAndMockAuction();
      const input = makeItemInput(auction._id as Types.ObjectId, {
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 3_600_000),
      });
      await expect(itemService.createItem(mockAdmin, input)).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when endTime is before startTime', async () => {
      const auction = await seedAndMockAuction();
      const input = makeItemInput(auction._id as Types.ObjectId, {
        startTime: new Date(Date.now() + 3_600_000),
        endTime: new Date(Date.now() + 1_800_000),
      });
      await expect(itemService.createItem(mockAdmin, input)).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when auction does not exist', async () => {
      (auctionService.getById as jest.Mock).mockResolvedValueOnce(null);
      const input = makeItemInput(new Types.ObjectId());
      await expect(itemService.createItem(mockAdmin, input)).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when auction is not NOT_BEGUN', async () => {
      const auction = await seedAndMockAuction('ACTIVE');
      const input = makeItemInput(auction._id as Types.ObjectId);
      await expect(itemService.createItem(mockAdmin, input)).rejects.toThrow(ForbiddenError);
    });

    it('persists the item with status NOT_BEGUN (happy path)', async () => {
      const auction = await seedAndMockAuction();
      const input = makeItemInput(auction._id as Types.ObjectId);

      const result = await itemService.createItem(mockAdmin, input);

      expect(result.status).toBe('NOT_BEGUN');
      const stored = await Item.findById(result._id);
      expect(stored).not.toBeNull();
    });
  });

  // ─── isInvited ────────────────────────────────────────────────────────────

  describe('isInvited', () => {
    const bidderId = new Types.ObjectId();
    const otherBidderId = new Types.ObjectId();

    async function seedAuction(overrides: Record<string, any> = {}) {
      const data = {
        ...buildAuction(),
        thumbnailUrl: 'https://example.com/thumb.jpg',
        auctionCoordinates: { type: 'Point', coordinates: [25.91, -24.65] },
        publishedBy: new Types.ObjectId(),
        globallyEligibleBidders: [],
        numberOfLots: 0,
        invitedBidders: [],
        ...overrides,
      };
      await Auction.collection.insertOne(data as any);
      return data;
    }

    it('returns true when the user is in item.invitedBidders', async () => {
      const auction = await seedAuction();
      const item = await seedItem({ auctionId: auction._id as any, invitedBidders: [bidderId as any] });
      const result = await itemService.isInvited(item._id.toString(), bidderId.toString());
      expect(result).toBe(true);
    });

    it('returns true when the user is in auction.invitedBidders but not item.invitedBidders', async () => {
      const auction = await seedAuction({ invitedBidders: [bidderId] });
      const item = await seedItem({ auctionId: auction._id as any, invitedBidders: [] });
      const result = await itemService.isInvited(item._id.toString(), bidderId.toString());
      expect(result).toBe(true);
    });

    it('returns false when the user is in neither invited list', async () => {
      const auction = await seedAuction({ invitedBidders: [otherBidderId] });
      const item = await seedItem({ auctionId: auction._id as any, invitedBidders: [otherBidderId as any] });
      const result = await itemService.isInvited(item._id.toString(), bidderId.toString());
      expect(result).toBe(false);
    });

    it('throws NotFoundError when the item does not exist', async () => {
      const fakeId = new Types.ObjectId().toString();
      await expect(itemService.isInvited(fakeId, bidderId.toString())).rejects.toThrow(NotFoundError);
    });
  });
});
