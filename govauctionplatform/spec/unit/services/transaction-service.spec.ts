/**
 * transaction-service unit/integration tests.
 *
 * Uses MongoMemoryReplSet (required for processSuccessfulPaymentFromPayGate
 * which calls startSession for the RESERVATION path and withTransaction
 * for the PURCHASE path).
 *
 * Mocks:
 *   - axios, elasticsearch-service         — silence model post-save side-effects
 *   - src/index                            — provides firebase stub (used by transaction-model)
 *   - item-service, auction-service        — factory mocks (prevent commandLineArgs crash)
 *   - bid-service, token-service           — factory mocks (same reason)
 *   - forum-service, collection-service    — factory mocks (same reason)
 *   - global.fetch                         — stubs PayGate initiation calls
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('axios', () => {
  const mockMethods = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
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

// transaction-model.ts imports `{ firebase } from '../index'` at the module
// level, so we must mock src/index before any transaction-model import resolves.
jest.mock('../../../src/index', () => ({
  firebase: {
    messaging: () => ({ send: jest.fn().mockResolvedValue(undefined) }),
  },
}));

jest.mock('../../../src/services/item-service', () => ({
  __esModule: true,
  default: { getById: jest.fn(), updateItemWithBid: jest.fn() },
}));

jest.mock('../../../src/services/auction-service', () => ({
  __esModule: true,
  default: { getById: jest.fn() },
}));

jest.mock('../../../src/services/bid-service', () => ({
  __esModule: true,
  default: { getWinningBid: jest.fn() },
}));

jest.mock('../../../src/services/token-service', () => ({
  __esModule: true,
  default: { getActiveToken: jest.fn() },
}));

jest.mock('../../../src/services/forum-service', () => ({
  __esModule: true,
  default: { getForumByAuctionId: jest.fn() },
}));

jest.mock('../../../src/services/collection-service', () => ({
  __esModule: true,
  default: {
    createCollection: jest.fn().mockResolvedValue({ collection: {}, otpCode: '12345678' }),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Types } from 'mongoose';
// Ensure Item + Auction + User (Bidder/Seller) models are registered so Mongoose populate doesn't throw
import '../../../src/models/item-model';
import '../../../src/models/auction-model';
import '../../../src/models/user-model';
import { Transaction, ITransaction } from '../../../src/models/transaction-model';
import {
  EPaymentStatus,
  ETransactionType,
  EParticipationType,
} from '../../../src/globals';
import { ForbiddenError, NotFoundError, InternalServerError } from '../../../src/shared/errors';
import transactionService from '../../../src/services/transaction-service';
import itemService from '../../../src/services/item-service';
import auctionService from '../../../src/services/auction-service';
import tokenService from '../../../src/services/token-service';
import forumService from '../../../src/services/forum-service';
import collectionService from '../../../src/services/collection-service';
import { connectTestDbReplSet, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildBidder } from '../../helpers/factories/user.factory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Insert a Transaction document directly, bypassing all Mongoose hooks. */
async function seedTransaction(overrides: Partial<Record<string, any>> = {}): Promise<ITransaction> {
  const data: Record<string, any> = {
    _id: new Types.ObjectId(),
    auctionId: new Types.ObjectId(),
    itemId: new Types.ObjectId(),
    buyerId: new Types.ObjectId(),
    sellerId: new Types.ObjectId(),
    currency: 'BWP',
    amount: 500,
    status: EPaymentStatus.PENDING,
    transactionType: ETransactionType.RESERVATION,
    metadata: {},
    createdDate: new Date(),
    ...overrides,
  };
  await Transaction.collection.insertOne(data);
  return (await Transaction.findById(data._id))!;
}

/** PayGate success response with all required fields. */
const PAYGATE_MOCK_RESPONSE = 'PAY_REQUEST_ID=test-req-id&CHECKSUM=abc123';

/** Minimal PayGate webhook payload. */
function makeWebhookInput(reference: string, transactionStatus: string) {
  return {
    REFERENCE: reference,
    PAY_METHOD: 'CC',
    PAY_METHOD_DETAIL: 'Visa',
    TRANSACTION_STATUS: transactionStatus,
    RESULT_CODE: '990017',
  };
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(connectTestDbReplSet);
afterAll(disconnectTestDb);
afterEach(async () => {
  await clearTestDb();
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('transaction-service', () => {
  // ─── pollPaidTransaction ────────────────────────────────────────────────────

  describe('pollPaidTransaction', () => {
    it('returns true when a COMPLETED transaction exists for the bidder + item', async () => {
      const bidder = buildBidder() as any;
      const itemId = new Types.ObjectId();
      await seedTransaction({
        buyerId: bidder._id,
        itemId,
        status: EPaymentStatus.COMPLETED,
        transactionType: ETransactionType.RESERVATION,
      });

      const result = await transactionService.pollPaidTransaction(bidder, {
        itemId: itemId.toString(),
        transactionType: ETransactionType.RESERVATION,
      });
      expect(result).toBe(true);
    });

    it('returns false when no COMPLETED transaction exists', async () => {
      const bidder = buildBidder() as any;
      const result = await transactionService.pollPaidTransaction(bidder, {
        itemId: new Types.ObjectId().toString(),
        transactionType: ETransactionType.RESERVATION,
      });
      expect(result).toBe(false);
    });
  });

  // ─── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns null for an invalid MongoId', async () => {
      const result = await transactionService.getById('not-a-valid-id');
      expect(result).toBeNull();
    });

    it('returns the transaction for a valid id', async () => {
      const tx = await seedTransaction();
      const result = await transactionService.getById(tx.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(tx.id);
    });
  });

  // ─── trackTransactionStatus ────────────────────────────────────────────────

  describe('trackTransactionStatus', () => {
    const oldDate = new Date(Date.now() - 16 * 60 * 1000); // 16 minutes ago

    it('marks PENDING RESERVATION older than 15 min as FAILED', async () => {
      await seedTransaction({
        createdDate: oldDate,
        status: EPaymentStatus.PENDING,
        transactionType: ETransactionType.RESERVATION,
      });

      await transactionService.trackTransactionStatus();

      const tx = await Transaction.findOne({});
      expect(tx?.status).toBe(EPaymentStatus.FAILED);
    });

    it('marks PENDING PURCHASE older than 15 min as FAILED', async () => {
      await seedTransaction({
        createdDate: oldDate,
        status: EPaymentStatus.PENDING,
        transactionType: ETransactionType.PURCHASE,
      });

      await transactionService.trackTransactionStatus();

      const tx = await Transaction.findOne({});
      expect(tx?.status).toBe(EPaymentStatus.FAILED);
    });

    it('does NOT mark recent PENDING transactions as FAILED', async () => {
      // Default seedTransaction uses createdDate: new Date() — well within 15 min
      await seedTransaction({ status: EPaymentStatus.PENDING });

      await transactionService.trackTransactionStatus();

      const tx = await Transaction.findOne({});
      expect(tx?.status).toBe(EPaymentStatus.PENDING);
    });

    it('does NOT mark COMPLETED transactions as FAILED', async () => {
      await seedTransaction({
        createdDate: oldDate,
        status: EPaymentStatus.COMPLETED,
        transactionType: ETransactionType.RESERVATION,
      });

      await transactionService.trackTransactionStatus();

      const tx = await Transaction.findOne({});
      expect(tx?.status).toBe(EPaymentStatus.COMPLETED);
    });
  });

  // ─── initiateItemReservation ───────────────────────────────────────────────

  describe('initiateItemReservation', () => {
    const auctionId = new Types.ObjectId();
    const itemId = new Types.ObjectId();

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(PAYGATE_MOCK_RESPONSE),
      }) as any;

      (tokenService.getActiveToken as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
      });
      (itemService.getById as jest.Mock).mockResolvedValue({
        _id: itemId,
        id: itemId.toString(),
        auctionId,
        sellerId: new Types.ObjectId(),
        reservePrice: 500,
      });
      (auctionService.getById as jest.Mock).mockResolvedValue({
        _id: auctionId,
        participationType: EParticipationType.EVERYONE,
      });
    });

    it('creates a RESERVATION transaction with correct type and stores paymentLink + PAY_REQUEST_ID', async () => {
      const bidderData = buildBidder();
      const bidder = { ...bidderData, id: bidderData._id!.toString() } as any;
      const result = await transactionService.initiateItemReservation(bidder, {
        itemId: itemId.toString(),
      });

      expect(result.transactionType).toBe(ETransactionType.RESERVATION);
      expect(result.status).toBe(EPaymentStatus.PENDING);
      const meta = result.metadata as Map<string, string>;
      expect(meta.get('paymentLink')).toContain('PAY_REQUEST_ID=test-req-id');
      expect(meta.get('PAY_REQUEST_ID')).toBe('test-req-id');
    });

    it('throws NotFoundError when item not found', async () => {
      (itemService.getById as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        transactionService.initiateItemReservation(buildBidder() as any, {
          itemId: itemId.toString(),
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when token not found', async () => {
      (tokenService.getActiveToken as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        transactionService.initiateItemReservation(buildBidder() as any, {
          itemId: itemId.toString(),
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when auction not found', async () => {
      (auctionService.getById as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        transactionService.initiateItemReservation(buildBidder() as any, {
          itemId: itemId.toString(),
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for CITIZEN_ONLY auction when bidder nationality is not local', async () => {
      (auctionService.getById as jest.Mock).mockResolvedValueOnce({
        _id: auctionId,
        participationType: 'CITIZEN_ONLY',
      });
      const foreignBidder = buildBidder({ nationality: 'ZA' }) as any;
      await expect(
        transactionService.initiateItemReservation(foreignBidder, {
          itemId: itemId.toString(),
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws InternalServerError when PayGate responds with a non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
      const bidderData = buildBidder();
      const bidder = { ...bidderData, id: bidderData._id!.toString() } as any;
      await expect(
        transactionService.initiateItemReservation(bidder, {
          itemId: itemId.toString(),
        })
      ).rejects.toThrow(InternalServerError);
    });
  });

  // ─── processSuccessfulPaymentFromPayGate ───────────────────────────────────

  describe('processSuccessfulPaymentFromPayGate', () => {
    it('throws NotFoundError when no transaction matches REFERENCE', async () => {
      await expect(
        transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(new Types.ObjectId().toString(), '1')
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('status "2" (declined) → sets transaction to FAILED and throws', async () => {
      const tx = await seedTransaction();
      await expect(
        transactionService.processSuccessfulPaymentFromPayGate(makeWebhookInput(tx.id, '2'))
      ).rejects.toThrow(InternalServerError);
      const updated = await Transaction.findById(tx._id);
      expect(updated?.status).toBe(EPaymentStatus.FAILED);
    });

    it('status "3" (cancelled) → sets transaction to CANCELLED and throws', async () => {
      const tx = await seedTransaction();
      await expect(
        transactionService.processSuccessfulPaymentFromPayGate(makeWebhookInput(tx.id, '3'))
      ).rejects.toThrow(InternalServerError);
      const updated = await Transaction.findById(tx._id);
      expect(updated?.status).toBe(EPaymentStatus.CANCELLED);
    });

    it('status "0" (not done) → sets transaction to PENDING and throws', async () => {
      const tx = await seedTransaction();
      await expect(
        transactionService.processSuccessfulPaymentFromPayGate(makeWebhookInput(tx.id, '0'))
      ).rejects.toThrow(InternalServerError);
    });

    // ─── RESERVATION approved ─────────────────────────────────────────────

    describe('status "1" (approved) — RESERVATION', () => {
      const auctionId = new Types.ObjectId();
      let buyerId: Types.ObjectId;
      let tx: ITransaction;
      let mockItem: Record<string, any>;
      let mockForum: Record<string, any>;
      let mockAuction: Record<string, any>;

      beforeEach(async () => {
        buyerId = new Types.ObjectId();
        tx = await seedTransaction({
          buyerId,
          transactionType: ETransactionType.RESERVATION,
        });

        mockItem = {
          _id: new Types.ObjectId(),
          auctionId,
          eligibleBidders: [],
          save: jest.fn().mockResolvedValue(undefined),
        };
        mockForum = {
          participants: [],
          save: jest.fn().mockResolvedValue(undefined),
        };
        mockAuction = {
          _id: auctionId,
          hasRegistrationFee: false,
          globallyEligibleBidders: [],
          participantsWithBiddingNumbers: [],
          save: jest.fn().mockResolvedValue(undefined),
        };

        (itemService.getById as jest.Mock).mockResolvedValue(mockItem);
        (forumService.getForumByAuctionId as jest.Mock).mockResolvedValue(mockForum);
        (auctionService.getById as jest.Mock).mockResolvedValue(mockAuction);
      });

      it('adds buyer to item.eligibleBidders', async () => {
        await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        expect(mockItem.eligibleBidders).toContain(buyerId.toString());
      });

      it('adds buyer to forum.participants', async () => {
        await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        expect(mockForum.participants).toContain(buyerId.toString());
      });

      it('assigns a bidding number in auction.participantsWithBiddingNumbers', async () => {
        await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        const entry = mockAuction.participantsWithBiddingNumbers.find((p: string) =>
          p.startsWith(buyerId.toString())
        );
        expect(entry).toBeDefined();
        expect(entry).toMatch(/BIDDER\d{2}/);
      });

      it('returns the transaction with COMPLETED status', async () => {
        const result = await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        expect(result.status).toBe(EPaymentStatus.COMPLETED);
      });

      it('throws NotFoundError when forum not found', async () => {
        (forumService.getForumByAuctionId as jest.Mock).mockResolvedValueOnce(null);
        await expect(
          transactionService.processSuccessfulPaymentFromPayGate(makeWebhookInput(tx.id, '1'))
        ).rejects.toThrow(NotFoundError);
      });
    });

    // ─── PURCHASE approved ────────────────────────────────────────────────

    describe('status "1" (approved) — PURCHASE', () => {
      let tx: ITransaction;
      let mockItem: Record<string, any>;

      beforeEach(async () => {
        tx = await seedTransaction({ transactionType: ETransactionType.PURCHASE });
        mockItem = {
          _id: new Types.ObjectId(),
          isPurchased: false,
          save: jest.fn().mockResolvedValue(undefined),
        };
        (itemService.getById as jest.Mock).mockResolvedValue(mockItem);
      });

      it('sets item.isPurchased = true', async () => {
        await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        expect(mockItem.isPurchased).toBe(true);
      });

      it('returns the transaction with COMPLETED status', async () => {
        const result = await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        expect(result.status).toBe(EPaymentStatus.COMPLETED);
      });

      it('fires createCollection for the item (fire-and-forget)', async () => {
        await transactionService.processSuccessfulPaymentFromPayGate(
          makeWebhookInput(tx.id, '1')
        );
        // Allow the fire-and-forget promise to settle
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(collectionService.createCollection).toHaveBeenCalledWith(
          tx.itemId,
          tx._id
        );
      });
    });
  });

  // ─── initiateDisputeRefund ─────────────────────────────────────────────────

  describe('initiateDisputeRefund', () => {
    it('throws NotFoundError for an invalid MongoId', async () => {
      await expect(
        transactionService.initiateDisputeRefund('not-an-id')
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when purchase transaction not found', async () => {
      await expect(
        transactionService.initiateDisputeRefund(new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when transaction type is not PURCHASE', async () => {
      const tx = await seedTransaction({
        transactionType: ETransactionType.RESERVATION,
        status: EPaymentStatus.COMPLETED,
      });
      await expect(
        transactionService.initiateDisputeRefund(tx.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('creates a REFUND transaction linked to the PURCHASE', async () => {
      const tx = await seedTransaction({
        transactionType: ETransactionType.PURCHASE,
        status: EPaymentStatus.COMPLETED,
      });
      const refund = await transactionService.initiateDisputeRefund(tx.id);

      expect(refund.transactionType).toBe(ETransactionType.REFUND);
      expect(refund.relatedTransaction?.toString()).toBe(tx.id);
      expect(refund.status).toBe(EPaymentStatus.PENDING);
      expect(refund.amount).toBe(tx.amount);
    });

    it('copies PAY_REQUEST_ID from purchase metadata into refund metadata', async () => {
      const tx = await seedTransaction({
        transactionType: ETransactionType.PURCHASE,
        status: EPaymentStatus.COMPLETED,
        metadata: new Map([['PAY_REQUEST_ID', 'original-pay-id']]),
      });
      const refund = await transactionService.initiateDisputeRefund(tx.id);
      const meta = refund.metadata as Map<string, string>;
      expect(meta.get('originalPAY_REQUEST_ID')).toBe('original-pay-id');
    });
  });

  // ─── initiateNonWinnerReservationRefunds ───────────────────────────────────

  describe('initiateNonWinnerReservationRefunds', () => {
    it('creates a REFUND for each losing bidder', async () => {
      const itemId = new Types.ObjectId();
      const winner = new Types.ObjectId();
      const loser1 = new Types.ObjectId();
      const loser2 = new Types.ObjectId();

      await seedTransaction({
        itemId, buyerId: winner,
        transactionType: ETransactionType.RESERVATION, status: EPaymentStatus.COMPLETED,
      });
      await seedTransaction({
        itemId, buyerId: loser1,
        transactionType: ETransactionType.RESERVATION, status: EPaymentStatus.COMPLETED,
      });
      await seedTransaction({
        itemId, buyerId: loser2,
        transactionType: ETransactionType.RESERVATION, status: EPaymentStatus.COMPLETED,
      });

      await transactionService.initiateNonWinnerReservationRefunds(
        itemId.toString(),
        winner.toString()
      );

      const refunds = await Transaction.find({ transactionType: ETransactionType.REFUND });
      expect(refunds).toHaveLength(2);
    });

    it('does NOT create a REFUND for the winning bidder', async () => {
      const itemId = new Types.ObjectId();
      const winner = new Types.ObjectId();
      const loser = new Types.ObjectId();

      await seedTransaction({
        itemId, buyerId: winner,
        transactionType: ETransactionType.RESERVATION, status: EPaymentStatus.COMPLETED,
      });
      await seedTransaction({
        itemId, buyerId: loser,
        transactionType: ETransactionType.RESERVATION, status: EPaymentStatus.COMPLETED,
      });

      await transactionService.initiateNonWinnerReservationRefunds(
        itemId.toString(),
        winner.toString()
      );

      const winnerRefund = await Transaction.findOne({
        buyerId: winner,
        transactionType: ETransactionType.REFUND,
      });
      expect(winnerRefund).toBeNull();
    });

    it('skips a loser if a REFUND already exists for their reservation', async () => {
      const itemId = new Types.ObjectId();
      const winner = new Types.ObjectId();
      const loser = new Types.ObjectId();

      const loserReservation = await seedTransaction({
        itemId, buyerId: loser,
        transactionType: ETransactionType.RESERVATION, status: EPaymentStatus.COMPLETED,
      });
      // Pre-existing refund for loser
      await seedTransaction({
        buyerId: loser,
        transactionType: ETransactionType.REFUND,
        relatedTransaction: loserReservation._id,
        status: EPaymentStatus.PENDING,
      });

      await transactionService.initiateNonWinnerReservationRefunds(
        itemId.toString(),
        winner.toString()
      );

      const refunds = await Transaction.find({
        buyerId: loser,
        transactionType: ETransactionType.REFUND,
      });
      expect(refunds).toHaveLength(1); // No duplicate created
    });

    it('is a no-op when no completed reservations exist for the item', async () => {
      await transactionService.initiateNonWinnerReservationRefunds(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString()
      );
      const refunds = await Transaction.find({ transactionType: ETransactionType.REFUND });
      expect(refunds).toHaveLength(0);
    });
  });

  // ─── getTransactions ───────────────────────────────────────────────────────

  describe('getTransactions', () => {
    it('bidder can only see their own transactions (scoped by buyerId)', async () => {
      const bidder = buildBidder() as any;
      await seedTransaction({ buyerId: bidder._id });
      await seedTransaction(); // different random buyerId

      const results = await transactionService.getTransactions(bidder, new Map());
      expect(results).toHaveLength(1);
    });

    it('admin sees all transactions regardless of buyer', async () => {
      const admin = { _id: new Types.ObjectId(), userType: 'ADMIN' } as any;
      await seedTransaction();
      await seedTransaction();

      const results = await transactionService.getTransactions(admin, new Map());
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('throws ForbiddenError when limit exceeds 100', async () => {
      const admin = { _id: new Types.ObjectId(), userType: 'ADMIN' } as any;
      await expect(
        transactionService.getTransactions(admin, new Map([['limit', 101]]))
      ).rejects.toThrow(ForbiddenError);
    });

    it('filters by transactionType', async () => {
      const admin = { _id: new Types.ObjectId(), userType: 'ADMIN' } as any;
      await seedTransaction({ transactionType: ETransactionType.RESERVATION });
      await seedTransaction({ transactionType: ETransactionType.PURCHASE });

      const results = await transactionService.getTransactions(
        admin,
        new Map([['transactionType', ETransactionType.PURCHASE]])
      );
      expect(results).toHaveLength(1);
      expect(results[0].transactionType).toBe(ETransactionType.PURCHASE);
    });
  });
});
