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

jest.mock('../../../src/services/auction-service', () => ({
  __esModule: true,
  default: {
    createAuction: jest.fn(),
    createRequiredAttribute: jest.fn(),
    deleteAuction: jest.fn(),
    getAuctionReport: jest.fn(),
    getRequiredAttributes: jest.fn(),
    publishAuction: jest.fn(),
    unpublishAuction: jest.fn(),
    rejectAuction: jest.fn(),
    getAuctions: jest.fn(),
    updateAuctionCoordinates: jest.fn(),
  },
}));

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import auctionService from '../../../src/services/auction-service';
import auctionRouter, { p } from '../../../src/routes/auction-router';
import { CustomError, NotFoundError } from '../../../src/shared/errors';
import { buildAdmin } from '../../helpers/factories/user.factory';
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
  app.use(auctionRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();
const AUCTION_ID = new Types.ObjectId().toHexString();
const CATEGORY_ID = new Types.ObjectId().toHexString();
const STUB_AUCTION = { _id: AUCTION_ID, title: { en: 'Test', tn: 'Test' } };

const VALID_CREATE_BODY = {
  title: { en: 'Livestock Auction', tn: 'Livestock Auction TN' },
  auctionLocation: 'Gaborone, Botswana',
  auctionCoordinates: { coordinates: [25.91, -24.65] },
  terms: { en: 'Standard terms apply.', tn: 'Standard terms apply TN.' },
  isBeingLivestreamed: false,
  thumbnailUrl: 'https://example.com/thumb.jpg',
  hasRegistrationFee: false,
  categoryId: CATEGORY_ID,
  startTime: new Date(Date.now() + 86400000).toISOString(),
  endTime: new Date(Date.now() + 172800000).toISOString(),
  participationType: 'EVERYONE',
  requiredAttributes: [],
  collectionWindowDays: 3,
  collectionStartTime: '08:00',
  collectionEndTime: '17:00',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('auction-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildAdmin(), _id: new Types.ObjectId(), id: new Types.ObjectId().toHexString() };
    injectPermissions = Object.values(EPermission).filter(p => p.startsWith('auction:'));
  });

  // ─── POST /createAuction ──────────────────────────────────────────────────

  describe('POST /createAuction', () => {
    it('returns 201 with auction on happy path', async () => {
      (auctionService.createAuction as jest.Mock).mockResolvedValue(STUB_AUCTION);
      const res = await request(app).post(p.createAuction).send(VALID_CREATE_BODY);
      expect(res.status).toBe(201);
      expect(res.body.auction).toBeDefined();
    });

    it('returns 401 when AUCTION_CREATE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.createAuction).send(VALID_CREATE_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when title is missing', async () => {
      const { title: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createAuction).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when categoryId is missing', async () => {
      const { categoryId: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createAuction).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when collectionWindowDays is missing', async () => {
      const { collectionWindowDays: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createAuction).send(body);
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /deleteAuction ────────────────────────────────────────────────

  describe('DELETE /deleteAuction', () => {
    it('returns 200 on successful deletion', async () => {
      (auctionService.deleteAuction as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).delete(p.deleteAuction).query({ auctionId: AUCTION_ID });
      expect(res.status).toBe(200);
    });

    it('returns 401 when AUCTION_DELETE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).delete(p.deleteAuction).query({ auctionId: AUCTION_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when auctionId is missing', async () => {
      const res = await request(app).delete(p.deleteAuction).query({});
      expect(res.status).toBe(400);
    });

    it('propagates NotFoundError as 404', async () => {
      (auctionService.deleteAuction as jest.Mock).mockRejectedValue(new NotFoundError('Auction not found'));
      const res = await request(app).delete(p.deleteAuction).query({ auctionId: AUCTION_ID });
      expect(res.status).toBe(404);
    });
  });

  // ─── PUT /publishAuction ──────────────────────────────────────────────────

  describe('PUT /publishAuction', () => {
    it('returns 200 with published auction on happy path', async () => {
      (auctionService.publishAuction as jest.Mock).mockResolvedValue({ ...STUB_AUCTION, publishedStatus: 'PUBLISHED' });
      const res = await request(app).put(p.publishAuction).send({ auctionId: AUCTION_ID });
      expect(res.status).toBe(200);
    });

    it('returns 401 when AUCTION_APPROVE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).put(p.publishAuction).send({ auctionId: AUCTION_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when auctionId is missing', async () => {
      const res = await request(app).put(p.publishAuction).send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /unpublishAuction ────────────────────────────────────────────────

  describe('PUT /unpublishAuction', () => {
    it('returns 200 on successful unpublish', async () => {
      (auctionService.unpublishAuction as jest.Mock).mockResolvedValue({ ...STUB_AUCTION, publishedStatus: 'UNPUBLISHED' });
      const res = await request(app).put(p.unpublishAuction).send({ auctionId: AUCTION_ID });
      expect(res.status).toBe(200);
    });

    it('returns 401 when AUCTION_UNPUBLISH permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).put(p.unpublishAuction).send({ auctionId: AUCTION_ID });
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /rejectAuction ───────────────────────────────────────────────────

  describe('PUT /rejectAuction', () => {
    it('returns 200 on successful rejection', async () => {
      (auctionService.rejectAuction as jest.Mock).mockResolvedValue({ ...STUB_AUCTION, publishedStatus: 'REJECTED' });
      const res = await request(app).put(p.rejectAuction).send({ auctionId: AUCTION_ID, reason: 'Does not meet requirements.' });
      expect(res.status).toBe(200);
    });

    it('returns 401 when AUCTION_REJECT permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).put(p.rejectAuction).send({ auctionId: AUCTION_ID, reason: 'some reason' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when auctionId is missing', async () => {
      const res = await request(app).put(p.rejectAuction).send({ reason: 'some reason' });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getAllAuctions ───────────────────────────────────────────────────

  describe('GET /getAllAuctions', () => {
    const VALID_QUERY = { sortOrder: 'asc', sortBy: 'DATE', limit: '20' };

    it('returns 200 with auctions array on happy path', async () => {
      (auctionService.getAuctions as jest.Mock).mockResolvedValue([STUB_AUCTION]);
      const res = await request(app).get(p.getAllAuctions).query(VALID_QUERY);
      expect(res.status).toBe(200);
      expect(res.body.auctions).toBeDefined();
    });

    it('returns 401 when AUCTION_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getAllAuctions).query(VALID_QUERY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder is missing', async () => {
      const { sortOrder: _, ...q } = VALID_QUERY;
      const res = await request(app).get(p.getAllAuctions).query(q);
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getAuctionReport ────────────────────────────────────────────────

  describe('GET /getAuctionReport', () => {
    it('returns 200 with report on happy path', async () => {
      (auctionService.getAuctionReport as jest.Mock).mockResolvedValue({ total: 5 });
      const res = await request(app).get(p.getAuctionReport).query({ auctionId: AUCTION_ID });
      expect(res.status).toBe(200);
      expect(res.body.report).toBeDefined();
    });

    it('returns 401 when AUCTION_REPORT permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getAuctionReport).query({ auctionId: AUCTION_ID });
      expect(res.status).toBe(401);
    });
  });
});
