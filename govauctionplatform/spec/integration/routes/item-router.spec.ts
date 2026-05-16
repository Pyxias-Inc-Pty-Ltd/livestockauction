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
    SellerOnly: () => (_req: any, _res: any, next: any) => next(),
    BidderOnly: () => (req: any, _res: any, next: any) => {
      if (!req.user) return next(new UnauthorizedError('Authentication required'));
      next();
    },
  };
});

jest.mock('../../../src/services/item-service', () => ({
  __esModule: true,
  default: {
    createItem: jest.fn(),
    setWinningBidder: jest.fn(),
    deleteItem: jest.fn(),
    getManualBidAmount: jest.fn(),
    getItemsWon: jest.fn(),
    getEligibleBidders: jest.fn(),
    isInvited: jest.fn(),
  },
}));

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import itemService from '../../../src/services/item-service';
import itemRouter, { p } from '../../../src/routes/item-router';
import { CustomError, NotFoundError } from '../../../src/shared/errors';
import { buildBidder, buildAdmin } from '../../helpers/factories/user.factory';
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
  app.use(itemRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();
const ITEM_ID = new Types.ObjectId().toHexString();
const AUCTION_ID = new Types.ObjectId().toHexString();
const FORM_ID = new Types.ObjectId().toHexString();
const SELLER_ID = new Types.ObjectId().toHexString();
const CATEGORY_ID = new Types.ObjectId().toHexString();
const STUB_ITEM = { _id: ITEM_ID, title: { en: 'Test Item', tn: 'Test Item' } };

const VALID_CREATE_BODY = {
  formId: FORM_ID,
  auctionId: AUCTION_ID,
  sellerId: SELLER_ID,
  gallery: [],
  title: { en: 'Test Item', tn: 'Test Item TN' },
  description: { en: 'A test description.', tn: 'A test description TN.' },
  terms: { en: 'Standard terms.', tn: 'Standard terms TN.' },
  startingBid: 500,
  bidIncrement: 100,
  reservePrice: 0,
  isBidIncrementedManually: false,
  isClosedBidding: false,
  startTime: new Date(Date.now() + 86400000).toISOString(),
  endTime: new Date(Date.now() + 172800000).toISOString(),
  metadata: { isLivestock: false },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('item-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildAdmin(), _id: new Types.ObjectId(), id: new Types.ObjectId().toHexString() };
    injectPermissions = Object.values(EPermission).filter(p => p.startsWith('lot:'));
  });

  // ─── GET /getItemsWon ─────────────────────────────────────────────────────

  describe('GET /getItemsWon', () => {
    const VALID_QUERY = { sortOrder: 'asc', sortBy: 'DATE', limit: '10' };

    it('returns 200 with items array on happy path', async () => {
      (itemService.getItemsWon as jest.Mock).mockResolvedValue([STUB_ITEM]);
      const res = await request(app).get(p.getItemsWon).query(VALID_QUERY);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('returns 401 when LOT_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getItemsWon).query(VALID_QUERY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder is missing', async () => {
      const { sortOrder: _, ...q } = VALID_QUERY;
      const res = await request(app).get(p.getItemsWon).query(q);
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /createItem ─────────────────────────────────────────────────────

  describe('POST /createItem', () => {
    it('returns 201 with item on happy path', async () => {
      (itemService.createItem as jest.Mock).mockResolvedValue(STUB_ITEM);
      const res = await request(app).post(p.createItem).send(VALID_CREATE_BODY);
      expect(res.status).toBe(201);
      expect(res.body.item).toBeDefined();
    });

    it('returns 401 when LOT_CREATE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.createItem).send(VALID_CREATE_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when auctionId is missing', async () => {
      const { auctionId: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createItem).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when title is missing', async () => {
      const { title: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createItem).send(body);
      expect(res.status).toBe(400);
    });

    it('propagates NotFoundError as 404', async () => {
      (itemService.createItem as jest.Mock).mockRejectedValue(new NotFoundError('Auction not found'));
      const res = await request(app).post(p.createItem).send(VALID_CREATE_BODY);
      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /deleteItem ───────────────────────────────────────────────────

  describe('DELETE /deleteItem', () => {
    it('returns 200 on successful deletion', async () => {
      (itemService.deleteItem as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).delete(p.deleteItem).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
    });

    it('returns 401 when LOT_MANAGE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).delete(p.deleteItem).query({ itemId: ITEM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when id is missing', async () => {
      const res = await request(app).delete(p.deleteItem).query({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getManualBidAmount ──────────────────────────────────────────────

  describe('GET /getManualBidAmount', () => {
    it('returns 200 with manualBidAmount on happy path', async () => {
      (itemService.getManualBidAmount as jest.Mock).mockResolvedValue(1500);
      const res = await request(app).get(p.getManualBidAmount).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.manualBidAmount).toBe(1500);
    });

    it('returns 401 when LOT_BID_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getManualBidAmount).query({ itemId: ITEM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).get(p.getManualBidAmount).query({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /isInvited ───────────────────────────────────────────────────────

  describe('GET /isInvited', () => {
    beforeEach(() => {
      injectUser = { ...buildBidder(), _id: new Types.ObjectId(), id: new Types.ObjectId().toHexString() };
    });

    it('returns 200 { invited: true } when service returns true', async () => {
      (itemService.isInvited as jest.Mock).mockResolvedValue(true);
      const res = await request(app).get(p.isInvited).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.invited).toBe(true);
    });

    it('returns 200 { invited: false } when service returns false', async () => {
      (itemService.isInvited as jest.Mock).mockResolvedValue(false);
      const res = await request(app).get(p.isInvited).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.invited).toBe(false);
    });

    it('returns 401 when user is not authenticated', async () => {
      injectUser = undefined;
      const res = await request(app).get(p.isInvited).query({ itemId: ITEM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when itemId is missing', async () => {
      const res = await request(app).get(p.isInvited).query({});
      expect(res.status).toBe(400);
    });

    it('passes the authenticated user id to the service', async () => {
      (itemService.isInvited as jest.Mock).mockResolvedValue(true);
      const res = await request(app).get(p.isInvited).query({ itemId: ITEM_ID });
      expect(res.status).toBe(200);
      expect(itemService.isInvited).toHaveBeenCalledWith(ITEM_ID, injectUser.id);
    });
  });
});
