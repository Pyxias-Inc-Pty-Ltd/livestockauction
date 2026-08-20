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

jest.mock('../../../src/services/transaction-service', () => ({
  __esModule: true,
  default: {
    initiateItemReservation: jest.fn(),
    initiatePurchaseItemByWinningBidder: jest.fn(),
    initiatePaymentForUser: jest.fn(),
  },
}));

jest.mock('../../../src/services/user-service', () => {
  const { NotFoundError } = jest.requireActual('../../../src/shared/errors');
  return {
    __esModule: true,
    default: {
      addStrike: jest.fn().mockResolvedValue(undefined),
      removeBlacklist: jest.fn().mockResolvedValue(undefined),
      isBlacklisted: jest.fn().mockResolvedValue(false),
      NotFoundError,
    },
    addStrike: jest.fn().mockResolvedValue(undefined),
    removeBlacklist: jest.fn().mockResolvedValue(undefined),
    isBlacklisted: jest.fn().mockResolvedValue(false),
  };
});

jest.mock('../../../src/queues/close-lot-queue', () => ({
  scheduleCloseLot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/shared/bid-lock', () => ({
  acquireBidLockWithWait: jest.fn().mockResolvedValue(true),
  releaseBidLock: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/shared/socket-emitter', () => {
  const emittedEvents: { room: string; event: string; args: any[] }[] = [];
  const mockEmitter = {
    to: (room: string) => ({
      emit: (event: string, ...args: any[]) => {
        emittedEvents.push({ room, event, args });
      },
    }),
    _emittedEvents: emittedEvents,
    _reset: () => { emittedEvents.length = 0; },
  };
  return { socketEmitter: mockEmitter };
});

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Types } from 'mongoose';
import { Item, IItem, IItemInput } from '../../../src/models/item-model';
import { Bid } from '../../../src/models/bid-model';
import '../../../src/models/form-model';    // register Form model so populate doesn't throw
import '../../../src/models/user-model';   // register Bidder model for getEligibleBidders
import '../../../src/models/auction-model'; // register Auction model (item pre-save hook queries it)
import { ForbiddenError, InternalServerError, NotFoundError } from '../../../src/shared/errors';
import { EItemStatus, EPublishedStatus, ESocketEventCode, FLOOR_BID_USER_ID } from '../../../src/globals';
import itemService from '../../../src/services/item-service';
import auctionService from '../../../src/services/auction-service';
import bidService from '../../../src/services/bid-service';
import { connectTestDbReplSet, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildItem } from '../../helpers/factories/item.factory';
import { buildBid } from '../../helpers/factories/bid.factory';
import { Auction } from '../../../src/models/auction-model';
import { buildAuction } from '../../helpers/factories/auction.factory';
import { scheduleCloseLot } from '../../../src/queues/close-lot-queue';
import { acquireBidLockWithWait, releaseBidLock } from '../../../src/shared/bid-lock';
import { socketEmitter } from '../../../src/shared/socket-emitter';

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

/** Seed a real Bid document (setWinningBidder verifies against the DB via Bid.exists). */
async function seedBid(overrides: any = {}): Promise<any> {
  return Bid.create(buildBid(overrides) as any);
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
  (socketEmitter as any)._reset();
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

    it('throws ForbiddenError when the supplied bidder has no bid at the winning amount', async () => {
      const bidderId = new Types.ObjectId();
      const otherBidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      // otherBidderId holds the only (winning) bid; bidderId has no bid at that amount.
      await seedBid({ itemId: item._id, userId: otherBidderId, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:00Z') });
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
      await seedBid({ itemId: item._id, userId: bidderId, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:00Z') });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: bidderId,
        bidAmount: 1000,
      });

      const result = await itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() });
      expect(result.winningBidder!.toString()).toBe(bidderId.toString());
    });

    it('allows a tied bidder to be selected (relaxed tie-break)', async () => {
      const bidderId = new Types.ObjectId();
      const otherBidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      // Two bids at the same amount; otherBidderId placed first (earliest tie),
      // but bidderId is tied at that amount and may still be awarded the lot.
      await seedBid({ itemId: item._id, userId: otherBidderId, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:00Z') });
      await seedBid({ itemId: item._id, userId: bidderId, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:01Z') });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: otherBidderId,
        bidAmount: 1000,
      });

      const result = await itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() });
      expect(result.winningBidder!.toString()).toBe(bidderId.toString());
    });

    it('allows the floor bidder to be selected when tied (livestream)', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ACTIVE,
        isBidIncrementedManually: true,
        eligibleBidders: [bidderId.toString()],
      });
      // Online bid and floor bid tied at the called price; the online bid is
      // earliest, but the clerk may still award the lot to the floor.
      await seedBid({ itemId: item._id, userId: bidderId, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:00Z') });
      await seedBid({ itemId: item._id, userId: FLOOR_BID_USER_ID as any, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:01Z') });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: bidderId,
        bidAmount: 1000,
      });

      const result = await itemService.setWinningBidder({ itemId: item.id, bidderId: FLOOR_BID_USER_ID });
      expect(result.winningBidder!.toString()).toBe(FLOOR_BID_USER_ID);
      expect(result.status).toBe(EItemStatus.AWAITING_FLOOR_REASSIGNMENT);
    });

    it('acquires the bid lock before reading the winning bid', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      await seedBid({ itemId: item._id, userId: bidderId, bidAmount: 1000, bidTime: new Date('2026-01-01T00:00:00Z') });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: bidderId,
        bidAmount: 1000,
      });

      await itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() });

      expect(acquireBidLockWithWait).toHaveBeenCalledWith(
        item._id.toString(),
        expect.stringContaining('set-winner:'),
      );
      // Lock acquired before getWinningBid — verify call order
      const lockOrder = (acquireBidLockWithWait as jest.Mock).mock.invocationCallOrder[0];
      const bidOrder = (bidService.getWinningBid as jest.Mock).mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(bidOrder);
    });

    it('releases the lock even when getWinningBid throws', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });
      (bidService.getWinningBid as jest.Mock).mockRejectedValueOnce(new Error('DB timeout'));

      await expect(
        itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() }),
      ).rejects.toThrow('DB timeout');

      expect(releaseBidLock).toHaveBeenCalled();
    });

    it('throws ForbiddenError when the bid lock cannot be acquired', async () => {
      (acquireBidLockWithWait as jest.Mock).mockResolvedValueOnce(false);

      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ENDED,
        eligibleBidders: [bidderId.toString()],
      });

      await expect(
        itemService.setWinningBidder({ itemId: item.id, bidderId: bidderId.toString() }),
      ).rejects.toThrow(ForbiddenError);

      // Lock was not acquired — should not have been released either
      expect(releaseBidLock).not.toHaveBeenCalled();
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

    it('emits BROADCAST_REFRESH_AFTER_WINNING to the bidding room when winner is assigned', async () => {
      const bidderId = new Types.ObjectId();
      const item = await seedItem({
        status: EItemStatus.ACTIVE,
        startTime: new Date(Date.now() - 7_200_000),
        endTime: new Date(Date.now() - 60_000),
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce({
        userId: bidderId,
        bidAmount: 1000,
      });

      await itemService.trackItemStatus();

      const events = (socketEmitter as any)._emittedEvents as { room: string; event: string; args: any[] }[];
      const broadcast = events.find(
        (e) => e.event === ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING,
      );
      expect(broadcast).toBeDefined();
      expect(broadcast!.room).toBe(`${item._id.toString()}-bid`);
      expect(broadcast!.args[0]).toBe(item._id.toString());
    });

    it('does NOT emit BROADCAST_REFRESH_AFTER_WINNING when lot goes unsold (no bids)', async () => {
      await seedItem({
        status: EItemStatus.ACTIVE,
        startTime: new Date(Date.now() - 7_200_000),
        endTime: new Date(Date.now() - 60_000),
      });
      (bidService.getWinningBid as jest.Mock).mockResolvedValueOnce(null);

      await itemService.trackItemStatus();

      const events = (socketEmitter as any)._emittedEvents as { room: string; event: string; args: any[] }[];
      const broadcast = events.find(
        (e) => e.event === ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING,
      );
      expect(broadcast).toBeUndefined();
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

    it('schedules the close-lot job with the item id and endTime', async () => {
      const auction = await seedAndMockAuction();
      const endTime = new Date(Date.now() + 7_200_000);
      const input = makeItemInput(auction._id as Types.ObjectId, { endTime });

      const result = await itemService.createItem(mockAdmin, input);

      // Allow the fire-and-forget promise to settle
      await new Promise((r) => setImmediate(r));

      expect(scheduleCloseLot).toHaveBeenCalledWith(
        result._id.toString(),
        expect.any(Date),
      );
    });
  });

  // ─── updateItem ────────────────────────────────────────────────────────────

  describe('updateItem', () => {
    it('throws ForbiddenError when caller is not the seller', async () => {
      const item = await seedItem({ status: EItemStatus.NOT_BEGUN });
      const wrongSeller = { id: new Types.ObjectId().toString() } as any;

      await expect(
        itemService.updateItem(wrongSeller, item.id, { startingBid: 600 }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when item status is not NOT_BEGUN', async () => {
      const sellerId = new Types.ObjectId();
      const item = await seedItem({ status: EItemStatus.ACTIVE, sellerId: sellerId as any });
      const seller = { id: sellerId.toString() } as any;

      await expect(
        itemService.updateItem(seller, item.id, { startingBid: 600 }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('updates fields and returns the saved item', async () => {
      const sellerId = new Types.ObjectId();
      const item = await seedItem({ status: EItemStatus.NOT_BEGUN, sellerId: sellerId as any });
      const seller = { id: sellerId.toString() } as any;

      const result = await itemService.updateItem(seller, item.id, { startingBid: 999 });

      expect(result.startingBid).toBe(999);
    });

    it('reschedules close-lot job when endTime is updated', async () => {
      const sellerId = new Types.ObjectId();
      const item = await seedItem({ status: EItemStatus.NOT_BEGUN, sellerId: sellerId as any });
      const seller = { id: sellerId.toString() } as any;
      const newEndTime = new Date(Date.now() + 9_000_000);

      await itemService.updateItem(seller, item.id, { endTime: newEndTime });

      await new Promise((r) => setImmediate(r));

      expect(scheduleCloseLot).toHaveBeenCalledWith(item._id.toString(), expect.any(Date));
    });

    it('does NOT call scheduleCloseLot when endTime is not in the input', async () => {
      const sellerId = new Types.ObjectId();
      const item = await seedItem({ status: EItemStatus.NOT_BEGUN, sellerId: sellerId as any });
      const seller = { id: sellerId.toString() } as any;

      await itemService.updateItem(seller, item.id, { startingBid: 750 });

      await new Promise((r) => setImmediate(r));

      expect(scheduleCloseLot).not.toHaveBeenCalled();
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

  // ───────────────────────────────────────────────────────────────────────────
  // reassignFloorBid — hybrid floor + online bidding
  // ───────────────────────────────────────────────────────────────────────────

  describe('reassignFloorBid', () => {
    it('reassigns the winning floor bid to a real bidder and transitions item to ENDED', async () => {
      const realBidderId = new Types.ObjectId();
      const clerkUser = { id: new Types.ObjectId().toString() } as any;
      const item = await seedItem({
        status: EItemStatus.AWAITING_FLOOR_REASSIGNMENT,
        isBidIncrementedManually: true,
      });
      const floorBid = await Bid.create({
        itemId: item._id,
        userId: FLOOR_BID_USER_ID,
        bidAmount: 800,
        bidTime: new Date(),
        isRetracted: false,
      });

      // Reset socket events before the call
      (socketEmitter as any)._reset();

      const updated = await itemService.reassignFloorBid(clerkUser, {
        itemId: item._id.toString(),
        bidderId: realBidderId.toString(),
        bidId: floorBid._id.toString(),
      });

      // Item transitions from AWAITING_FLOOR_REASSIGNMENT to ENDED
      expect(updated.status).toBe(EItemStatus.ENDED);
      expect(updated.winningBidder?.toString()).toBe(realBidderId.toString());
      expect(updated.floorBidReassignedTo?.toString()).toBe(realBidderId.toString());
      expect(updated.floorBidReassignedBy?.toString()).toBe(clerkUser.id.toString());
      expect(updated.floorBidReassignedAt).toBeDefined();

      // Bid is mutated with audit fields and reassigned userId
      const mutatedBid = await Bid.findById(floorBid._id);
      expect(mutatedBid!.userId.toString()).toBe(realBidderId.toString());
      expect(mutatedBid!.reassignedFrom!.toString()).toBe(FLOOR_BID_USER_ID);
      expect(mutatedBid!.reassignedTo!.toString()).toBe(realBidderId.toString());
      expect(mutatedBid!.reassignedBy!.toString()).toBe(clerkUser.id.toString());
      expect(mutatedBid!.reassignedAt).toBeDefined();

      // Socket event was emitted
      expect((socketEmitter as any)._emittedEvents).toContainEqual(
        expect.objectContaining({
          room: `${item._id.toString()}-bid`,
          event: ESocketEventCode.BROADCAST_FLOOR_REASSIGNMENT,
        }),
      );
    });

    it('throws ForbiddenError if item status is NOT AWAITING_FLOOR_REASSIGNMENT', async () => {
      const item = await seedItem({ status: EItemStatus.ACTIVE });
      const clerkUser = { id: new Types.ObjectId().toString() } as any;

      await expect(
        itemService.reassignFloorBid(clerkUser, {
          itemId: item._id.toString(),
          bidderId: new Types.ObjectId().toString(),
          bidId: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if the bid does not belong to the floor bid sentinel', async () => {
      const realUserId = new Types.ObjectId();
      const item = await seedItem({ status: EItemStatus.AWAITING_FLOOR_REASSIGNMENT });
      const normalBid = await Bid.create({
        itemId: item._id,
        userId: realUserId,
        bidAmount: 900,
        bidTime: new Date(),
        isRetracted: false,
      });
      const clerkUser = { id: new Types.ObjectId().toString() } as any;

      await expect(
        itemService.reassignFloorBid(clerkUser, {
          itemId: item._id.toString(),
          bidderId: new Types.ObjectId().toString(),
          bidId: normalBid._id.toString(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when item does not exist', async () => {
      const clerkUser = { id: new Types.ObjectId().toString() } as any;

      await expect(
        itemService.reassignFloorBid(clerkUser, {
          itemId: new Types.ObjectId().toString(),
          bidderId: new Types.ObjectId().toString(),
          bidId: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when bid does not exist', async () => {
      const item = await seedItem({ status: EItemStatus.AWAITING_FLOOR_REASSIGNMENT });
      const clerkUser = { id: new Types.ObjectId().toString() } as any;

      await expect(
        itemService.reassignFloorBid(clerkUser, {
          itemId: item._id.toString(),
          bidderId: new Types.ObjectId().toString(),
          bidId: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
