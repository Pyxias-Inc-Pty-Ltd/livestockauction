jest.mock('../../../src/shared/middleware', () => {
  const { UnauthorizedError } = jest.requireActual('../../../src/shared/errors');
  return {
    requirePermission: (...perms: string[]) => (req: any, _res: any, next: any) => {
      const missing = perms.filter((p: string) => !(req.permissions ?? []).includes(p));
      if (missing.length > 0) return next(new UnauthorizedError(`Missing: ${missing.join(', ')}`));
      next();
    },
    deserializeUser: (_req: any, _res: any, next: any) => next(),
    verifyWebhookSignature: (_req: any, _res: any, next: any) => next(),
  };
});

jest.mock('../../../src/services/transaction-service', () => ({
  __esModule: true,
  default: {
    initiateItemReservation: jest.fn(),
    initiatePurchaseItemByWinningBidder: jest.fn(),
    initiatePurchaseItemUsingBuyoutPrice: jest.fn(),
    getTransactions: jest.fn(),
  },
}));

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import transactionService from '../../../src/services/transaction-service';
import transactionRouter, { p } from '../../../src/routes/transaction-router';
import { CustomError, NotFoundError } from '../../../src/shared/errors';
import { buildBidder } from '../../helpers/factories/user.factory';
import { EPermission } from '../../../src/globals';

// ─── Mutable request context ─────────────────────────────────────────────────

let injectUser: any;
let injectPermissions: string[];

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = injectUser;
    req.permissions = injectPermissions;
    req.roles = [];
    next();
  });
  app.use(transactionRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();
const ITEM_ID = new Types.ObjectId().toHexString();
const VALID_ITEM_BODY = { itemId: ITEM_ID };
const VALID_GET_QUERY = { sortOrder: 'asc', sortBy: 'DATE', limit: '20' };

const mockReservation = transactionService.initiateItemReservation as jest.Mock;
const mockPurchaseWinner = transactionService.initiatePurchaseItemByWinningBidder as jest.Mock;
const mockPurchaseBuyout = transactionService.initiatePurchaseItemUsingBuyoutPrice as jest.Mock;
const mockGetTxns = transactionService.getTransactions as jest.Mock;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('transaction-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildBidder(), id: new Types.ObjectId().toHexString() };
    injectPermissions = [
      EPermission.TRANSACTION_RESERVE,
      EPermission.TRANSACTION_PURCHASE,
      EPermission.TRANSACTION_READ,
    ];
  });

  // ─── POST /initiateItemReservation ───────────────────────────────────────

  describe('POST /initiateItemReservation', () => {
    it('returns 201 with transaction on happy path', async () => {
      mockReservation.mockResolvedValue({ _id: 'txn1', type: 'RESERVATION' });
      const res = await request(app).post(p.initiateItemReservation).send(VALID_ITEM_BODY);
      expect(res.status).toBe(201);
      expect(res.body.transaction).toMatchObject({ type: 'RESERVATION' });
    });

    it('returns 401 when TRANSACTION_RESERVE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.initiateItemReservation).send(VALID_ITEM_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).post(p.initiateItemReservation).send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemId is not a valid MongoId', async () => {
      const res = await request(app).post(p.initiateItemReservation).send({ itemId: 'bad-id' });
      expect(res.status).toBe(400);
    });

    it('propagates NotFoundError as 404', async () => {
      mockReservation.mockRejectedValue(new NotFoundError('Item not found'));
      const res = await request(app).post(p.initiateItemReservation).send(VALID_ITEM_BODY);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /initiatePurchaseItemByWinningBidder ───────────────────────────

  describe('POST /initiatePurchaseItemByWinningBidder', () => {
    it('returns 201 with transaction on happy path', async () => {
      mockPurchaseWinner.mockResolvedValue({ _id: 'txn2', type: 'PURCHASE' });
      const res = await request(app).post(p.initiatePurchaseItemByWinningBidder).send(VALID_ITEM_BODY);
      expect(res.status).toBe(201);
      expect(res.body.transaction).toMatchObject({ type: 'PURCHASE' });
    });

    it('returns 401 when TRANSACTION_PURCHASE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.initiatePurchaseItemByWinningBidder).send(VALID_ITEM_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).post(p.initiatePurchaseItemByWinningBidder).send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /initiatePurchaseItemUsingBuyoutPrice ──────────────────────────

  describe('POST /initiatePurchaseItemUsingBuyoutPrice', () => {
    it('returns 201 with transaction on happy path', async () => {
      mockPurchaseBuyout.mockResolvedValue({ _id: 'txn3', type: 'PURCHASE' });
      const res = await request(app).post(p.initiatePurchaseItemUsingBuyoutPrice).send(VALID_ITEM_BODY);
      expect(res.status).toBe(201);
    });

    it('returns 401 when TRANSACTION_PURCHASE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.initiatePurchaseItemUsingBuyoutPrice).send(VALID_ITEM_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).post(p.initiatePurchaseItemUsingBuyoutPrice).send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getTransactions ────────────────────────────────────────────────

  describe('GET /getTransactions', () => {
    it('returns 200 with transactions array on happy path', async () => {
      mockGetTxns.mockResolvedValue([{ _id: 'txn4' }]);
      const res = await request(app).get(p.getTransactions).query(VALID_GET_QUERY);
      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(1);
    });

    it('returns 401 when TRANSACTION_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getTransactions).query(VALID_GET_QUERY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder is missing', async () => {
      const { sortOrder: _, ...q } = VALID_GET_QUERY;
      const res = await request(app).get(p.getTransactions).query(q);
      expect(res.status).toBe(400);
    });

    it('returns 400 when limit is missing', async () => {
      const { limit: _, ...q } = VALID_GET_QUERY;
      const res = await request(app).get(p.getTransactions).query(q);
      expect(res.status).toBe(400);
    });
  });
});
