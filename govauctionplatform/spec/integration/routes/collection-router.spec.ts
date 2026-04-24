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

jest.mock('../../../src/services/collection-service', () => ({
  __esModule: true,
  default: {
    validateCollectionCode: jest.fn(),
    raiseDispute: jest.fn(),
    resolveDispute: jest.fn(),
    getById: jest.fn(),
    getByItemId: jest.fn(),
    getCollections: jest.fn(),
    getMyCollection: jest.fn(),
    resendCollectionOtp: jest.fn(),
  },
}));

jest.mock('../../../src/services/transaction-service', () => ({
  __esModule: true,
  default: { initiateDisputeRefund: jest.fn() },
}));

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import collectionService from '../../../src/services/collection-service';
import transactionService from '../../../src/services/transaction-service';
import collectionRouter, { p } from '../../../src/routes/collection-router';
import { CustomError, NotFoundError } from '../../../src/shared/errors';
import { buildBidder } from '../../helpers/factories/user.factory';
import { ECollectionStatus, EPermission } from '../../../src/globals';

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
  app.use(collectionRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();

const COLLECTION_ID = new Types.ObjectId().toHexString();
const ITEM_ID = new Types.ObjectId().toHexString();
const STUB_COLLECTION = { _id: COLLECTION_ID, itemId: ITEM_ID, status: ECollectionStatus.AWAITING_COLLECTION, purchaseTransactionId: new Types.ObjectId().toHexString() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('collection-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildBidder(), id: new Types.ObjectId().toHexString() };
    injectPermissions = Object.values(EPermission).filter(p => p.startsWith('collection:'));
  });

  // ─── POST /validateCollectionCode ────────────────────────────────────────

  describe('POST /validateCollectionCode', () => {
    const VALID_BODY = { itemId: ITEM_ID, otpCode: '12345678' };

    it('returns 200 with collection on happy path', async () => {
      (collectionService.validateCollectionCode as jest.Mock).mockResolvedValue(STUB_COLLECTION);
      const res = await request(app).post(p.validateCollectionCode).send(VALID_BODY);
      expect(res.status).toBe(200);
      expect(res.body.collection).toBeDefined();
    });

    it('returns 401 when COLLECTION_VALIDATE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.validateCollectionCode).send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when otpCode is missing', async () => {
      const res = await request(app).post(p.validateCollectionCode).send({ itemId: ITEM_ID });
      expect(res.status).toBe(400);
    });

    it('returns 400 when otpCode is not 8 digits', async () => {
      const res = await request(app).post(p.validateCollectionCode).send({ itemId: ITEM_ID, otpCode: '1234' });
      expect(res.status).toBe(400);
    });

    it('propagates NotFoundError as 404', async () => {
      (collectionService.validateCollectionCode as jest.Mock).mockRejectedValue(new NotFoundError('Collection not found'));
      const res = await request(app).post(p.validateCollectionCode).send(VALID_BODY);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /raiseDispute ───────────────────────────────────────────────────

  describe('POST /raiseDispute', () => {
    const VALID_BODY = { collectionId: COLLECTION_ID, reason: 'Item was not as described in the listing' };

    it('returns 200 with collection on happy path', async () => {
      (collectionService.raiseDispute as jest.Mock).mockResolvedValue({ ...STUB_COLLECTION, status: 'DISPUTED' });
      const res = await request(app).post(p.raiseDispute).send(VALID_BODY);
      expect(res.status).toBe(200);
    });

    it('returns 401 when COLLECTION_DISPUTE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.raiseDispute).send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when reason is too short (< 10 chars)', async () => {
      const res = await request(app).post(p.raiseDispute).send({ collectionId: COLLECTION_ID, reason: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when collectionId is missing', async () => {
      const res = await request(app).post(p.raiseDispute).send({ reason: 'A valid reason longer than 10 chars' });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /resolveDispute ─────────────────────────────────────────────────

  describe('PUT /resolveDispute', () => {
    const VALID_BODY = { collectionId: COLLECTION_ID };

    it('returns 200 with resolved collection on happy path', async () => {
      (collectionService.resolveDispute as jest.Mock).mockResolvedValue({ ...STUB_COLLECTION, status: 'RESOLVED' });
      const res = await request(app).put(p.resolveDispute).send(VALID_BODY);
      expect(res.status).toBe(200);
    });

    it('returns 401 when COLLECTION_RESOLVE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).put(p.resolveDispute).send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when collectionId is missing', async () => {
      const res = await request(app).put(p.resolveDispute).send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /initiateDisputeRefund ─────────────────────────────────────────

  describe('POST /initiateDisputeRefund', () => {
    const VALID_BODY = { collectionId: COLLECTION_ID };

    it('returns 200 with refund transaction when collection is DISPUTED', async () => {
      (collectionService.getById as jest.Mock).mockResolvedValue({ ...STUB_COLLECTION, status: ECollectionStatus.DISPUTED });
      (transactionService.initiateDisputeRefund as jest.Mock).mockResolvedValue({ _id: 'refund1' });
      const res = await request(app).post(p.initiateDisputeRefund).send(VALID_BODY);
      expect(res.status).toBe(200);
      expect(res.body.refundTransaction).toBeDefined();
    });

    it('returns 401 when COLLECTION_REFUND permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.initiateDisputeRefund).send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when collectionId is missing', async () => {
      const res = await request(app).post(p.initiateDisputeRefund).send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when collection is not found', async () => {
      (collectionService.getById as jest.Mock).mockResolvedValue(null);
      const res = await request(app).post(p.initiateDisputeRefund).send(VALID_BODY);
      expect(res.status).toBe(404);
    });

    it('returns 400 when collection status is not DISPUTED', async () => {
      (collectionService.getById as jest.Mock).mockResolvedValue({ ...STUB_COLLECTION, status: ECollectionStatus.AWAITING_COLLECTION });
      const res = await request(app).post(p.initiateDisputeRefund).send(VALID_BODY);
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getByItemId ────────────────────────────────────────────────────

  describe('GET /getByItemId', () => {
    it('returns 200 with collection on happy path', async () => {
      (collectionService.getByItemId as jest.Mock).mockResolvedValue(STUB_COLLECTION);
      const res = await request(app).get(p.getByItemId).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.collection).toBeDefined();
    });

    it('returns 401 when COLLECTION_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getByItemId).query({ itemId: ITEM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).get(p.getByItemId).query({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getCollections ─────────────────────────────────────────────────

  describe('GET /getCollections', () => {
    const VALID_QUERY = { sortOrder: 'asc', limit: '20' };

    it('returns 200 with collections array on happy path', async () => {
      (collectionService.getCollections as jest.Mock).mockResolvedValue([STUB_COLLECTION]);
      const res = await request(app).get(p.getCollections).query(VALID_QUERY);
      expect(res.status).toBe(200);
      expect(res.body.collections).toHaveLength(1);
    });

    it('returns 401 when COLLECTION_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getCollections).query(VALID_QUERY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder is missing', async () => {
      const res = await request(app).get(p.getCollections).query({ limit: '20' });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getMyCollection ────────────────────────────────────────────────

  describe('GET /getMyCollection', () => {
    it('returns 200 with own collection on happy path', async () => {
      (collectionService.getMyCollection as jest.Mock).mockResolvedValue(STUB_COLLECTION);
      const res = await request(app).get(p.getMyCollection).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.collection).toBeDefined();
    });

    it('returns 401 when COLLECTION_READ_OWN permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getMyCollection).query({ itemId: ITEM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).get(p.getMyCollection).query({});
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /resendCollectionOtp ───────────────────────────────────────────

  describe('POST /resendCollectionOtp', () => {
    it('returns 200 with success message on happy path', async () => {
      (collectionService.resendCollectionOtp as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).post(p.resendCollectionOtp).send({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Collection code resent successfully');
    });

    it('returns 401 when COLLECTION_OTP_RESEND permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.resendCollectionOtp).send({ itemId: ITEM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).post(p.resendCollectionOtp).send({});
      expect(res.status).toBe(400);
    });
  });
});
