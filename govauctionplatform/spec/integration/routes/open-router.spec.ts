jest.mock('../../../src/shared/middleware', () => {
  const { UnauthorizedError } = jest.requireActual('../../../src/shared/errors');
  return {
    requirePermission: (...perms: string[]) => (req: any, _res: any, next: any) => {
      const missing = perms.filter((p: string) => !(req.permissions ?? []).includes(p));
      if (missing.length > 0) return next(new UnauthorizedError(`Missing: ${missing.join(', ')}`));
      next();
    },
    deserializeUser: (_req: any, _res: any, next: any) => next(),
    requireQueueApiKey: (_req: any, _res: any, next: any) => next(),
  };
});

jest.mock('../../../src/shared/functions', () => {
  const actual = jest.requireActual('../../../src/shared/functions');
  return {
    ...actual,
    validatePaygateNotifyChecksum: () => true,
  };
});

jest.mock('../../../src/services/user-service', () => ({
  __esModule: true,
  default: { createInitAdmin: jest.fn(), createBidder: jest.fn(), getById: jest.fn() },
}));
jest.mock('../../../src/services/transaction-service', () => ({
  __esModule: true,
  default: { processSuccessfulPaymentFromPayGate: jest.fn() },
}));
jest.mock('../../../src/services/auction-service', () => ({
  __esModule: true,
  default: { getById: jest.fn(), getByTitleSlug: jest.fn(), getAuctions: jest.fn() },
}));
jest.mock('../../../src/services/item-service', () => ({
  __esModule: true,
  default: { getById: jest.fn(), getByTitleSlug: jest.fn(), getItems: jest.fn() },
}));
jest.mock('../../../src/services/category-service', () => ({
  __esModule: true,
  default: { getById: jest.fn(), getCategories: jest.fn() },
}));
jest.mock('../../../src/services/elasticsearch-service', () => ({
  esService: {
    searchItems: jest.fn(),
    updateItemsWithAuction: jest.fn(),
    indexItem: jest.fn(),
    deleteItem: jest.fn(),
  },
}));

jest.mock('../../../src/models/user-model', () => {
  const actual = jest.requireActual('../../../src/models/user-model');
  return {
    ...actual,
    User: {
      findOne: jest.fn().mockResolvedValue({ _id: 'seller-id' }),
    },
  };
});

jest.mock('../../../src/models/auction-model', () => {
  const actual = jest.requireActual('../../../src/models/auction-model');
  return {
    ...actual,
    Auction: {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: 'auction-id',
          title: { en: 'Auction', tn: 'Auction' },
          toJSON: () => ({ _id: 'auction-id', title: { en: 'Auction', tn: 'Auction' } }),
          requiredAttributes: [],
        }),
      }),
    },
    RequiredAttribute: {
      find: jest.fn().mockResolvedValue([]),
    },
  };
});

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import userService from '../../../src/services/user-service';
import transactionService from '../../../src/services/transaction-service';
import auctionService from '../../../src/services/auction-service';
import itemService from '../../../src/services/item-service';
import categoryService from '../../../src/services/category-service';
import openRouter, { p } from '../../../src/routes/open-router';
import { CustomError } from '../../../src/shared/errors';

// ─── App setup ────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // No auth injection needed — open routes are public (no deserializeUser)
  app.use(openRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();

const ITEM_ID = new Types.ObjectId().toHexString();
const AUCTION_ID = new Types.ObjectId().toHexString();
const CATEGORY_ID = new Types.ObjectId().toHexString();
const STUB_ITEM = { _id: ITEM_ID, title: { en: 'Item', tn: 'Item' } };
const STUB_AUCTION = { _id: AUCTION_ID, title: { en: 'Auction', tn: 'Auction' } };

const VALID_BIDDER_BODY = {
  isOrganization: false,
  identityNumber: 'BWA12345',
  nationality: 'BW',
  dob: '1990-01-01',
  gender: 'MALE',
  physicalAddress: '123 Main Street, Gaborone',
  postalAddress: 'PO Box 123, Gaborone',
  phone: '+267 71234567',
  password: 'SecurePass123!',
  firstName: 'John',
  lastName: 'Doe',
  locale: 'en',
  tz: 'Africa/Gaborone',
};

const VALID_PAYGATE_BODY = {
  PAYGATE_ID: 'PG_TEST',
  PAY_REQUEST_ID: 'D7F69068-TEST',
  REFERENCE: new Types.ObjectId().toHexString(),
  TRANSACTION_STATUS: '1',
  RESULT_CODE: '990017',
  CURRENCY: 'BWP',
  AMOUNT: 10000,
  TRANSACTION_ID: 'TXN-001',
  CHECKSUM: 'abc123checksum',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('open-router', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── Public endpoints ─────────────────────────────────────────────────────

  describe('GET /getItemById', () => {
    it('returns 200 with item on happy path', async () => {
      (itemService.getById as jest.Mock).mockResolvedValue(STUB_ITEM);
      const res = await request(app).get(p.getItemById).query({ id: ITEM_ID });
      expect(res.status).toBe(200);
      expect(res.body.item).toBeDefined();
    });

    it('returns 400 when id is missing', async () => {
      const res = await request(app).get(p.getItemById).query({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /getAuctionById', () => {
    it('returns 200 with auction on happy path', async () => {
      (auctionService.getById as jest.Mock).mockResolvedValue(STUB_AUCTION);
      const res = await request(app).get(p.getAuctionById).query({ id: AUCTION_ID });
      expect(res.status).toBe(200);
      expect(res.body.auction).toBeDefined();
    });

    it('returns 400 when id is missing', async () => {
      const res = await request(app).get(p.getAuctionById).query({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /getAuctions', () => {
    it('returns 200 with auctions array on happy path', async () => {
      (auctionService.getAuctions as jest.Mock).mockResolvedValue([STUB_AUCTION]);
      const res = await request(app)
        .get(p.getAuctions)
        .query({ sortOrder: 'asc', sortBy: 'DATE', limit: '10' });
      expect(res.status).toBe(200);
      expect(res.body.auctions).toBeDefined();
    });

    it('returns 400 when sortOrder is missing', async () => {
      const res = await request(app).get(p.getAuctions).query({ sortBy: 'DATE', limit: '10' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /getCategoryById', () => {
    it('returns 200 with category on happy path', async () => {
      (categoryService.getById as jest.Mock).mockResolvedValue({ _id: CATEGORY_ID, name: 'Cattle' });
      const res = await request(app).get(p.getCategoryById).query({ id: CATEGORY_ID });
      expect(res.status).toBe(200);
      expect(res.body.category).toBeDefined();
    });

    it('returns 400 when id is missing', async () => {
      const res = await request(app).get(p.getCategoryById).query({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /createBidder', () => {
    it('returns 201 with new bidder on happy path (individual)', async () => {
      (userService.createBidder as jest.Mock).mockResolvedValue({ _id: new Types.ObjectId(), ...VALID_BIDDER_BODY });
      const res = await request(app).post(p.createBidder).send(VALID_BIDDER_BODY);
      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
    });

    it('returns 400 when identityNumber is missing', async () => {
      const { identityNumber: _, ...body } = VALID_BIDDER_BODY;
      const res = await request(app).post(p.createBidder).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when password is missing', async () => {
      const { password: _, ...body } = VALID_BIDDER_BODY;
      const res = await request(app).post(p.createBidder).send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /processSuccessfulPaymentFromPayGate', () => {
    it('returns 200 with transaction on happy path', async () => {
      (transactionService.processSuccessfulPaymentFromPayGate as jest.Mock).mockResolvedValue({ _id: 'txn1' });
      const res = await request(app).post(p.processSuccessfulPaymentFromPayGate).send(VALID_PAYGATE_BODY);
      expect(res.status).toBe(200);
    });

    it('returns 200 when PAYGATE_ID is missing (handler always responds OK to PayGate)', async () => {
      const { PAYGATE_ID: _, ...body } = VALID_PAYGATE_BODY;
      const res = await request(app).post(p.processSuccessfulPaymentFromPayGate).send(body);
      expect(res.status).toBe(200);
    });

    it('returns 200 when CHECKSUM is missing (handler always responds OK to PayGate)', async () => {
      const { CHECKSUM: _, ...body } = VALID_PAYGATE_BODY;
      const res = await request(app).post(p.processSuccessfulPaymentFromPayGate).send(body);
      expect(res.status).toBe(200);
    });
  });
});
