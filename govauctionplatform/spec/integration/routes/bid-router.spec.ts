// Prevent middleware.ts → src/index.ts import crash; reimplement guards inline.
jest.mock('../../../src/shared/middleware', () => {
  const { UnauthorizedError } = jest.requireActual('../../../src/shared/errors');
  return {
    requirePermission: (...perms: string[]) => (req: any, _res: any, next: any) => {
      const missing = perms.filter((p: string) => !(req.permissions ?? []).includes(p));
      if (missing.length > 0) return next(new UnauthorizedError(`Missing permission(s): ${missing.join(', ')}`));
      next();
    },
    deserializeUser: (_req: any, _res: any, next: any) => next(),
    verifyWebhookSignature: (_req: any, _res: any, next: any) => next(),
  };
});

jest.mock('../../../src/services/bid-service', () => ({
  __esModule: true,
  default: { getBids: jest.fn() },
}));

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import bidService from '../../../src/services/bid-service';
import bidRouter, { p } from '../../../src/routes/bid-router';
import { CustomError } from '../../../src/shared/errors';
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
  app.use(bidRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();
const getBidsMock = bidService.getBids as jest.Mock;

const ITEM_ID = new Types.ObjectId().toHexString();
const VALID_QUERY = {
  sortOrder: 'asc',
  sortBy: 'DATE',
  itemId: ITEM_ID,
  limit: '20',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bid-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildBidder(), id: new Types.ObjectId().toHexString() };
    injectPermissions = [EPermission.LOT_BID_READ];
  });

  describe('GET /getBids', () => {
    it('returns 200 with bids array on happy path', async () => {
      getBidsMock.mockResolvedValue([{ _id: 'bid1', bidAmount: 500 }]);
      const res = await request(app).get(p.getBids).query(VALID_QUERY);
      expect(res.status).toBe(200);
      expect(res.body.bids).toHaveLength(1);
    });

    it('calls bidService.getBids with the itemId from the query', async () => {
      getBidsMock.mockResolvedValue([]);
      await request(app).get(p.getBids).query(VALID_QUERY);
      expect(getBidsMock).toHaveBeenCalledWith(ITEM_ID, expect.any(Map));
    });

    it('returns 401 when required permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getBids).query(VALID_QUERY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder query param is missing', async () => {
      const { sortOrder: _, ...q } = VALID_QUERY;
      const res = await request(app).get(p.getBids).query(q);
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemId is not a valid MongoId', async () => {
      const res = await request(app).get(p.getBids).query({ ...VALID_QUERY, itemId: 'not-valid' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when limit is missing', async () => {
      const { limit: _, ...q } = VALID_QUERY;
      const res = await request(app).get(p.getBids).query(q);
      expect(res.status).toBe(400);
    });
  });
});
