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

jest.mock('../../../src/services/user-service', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
    getUsers: jest.fn(),
    createSeller: jest.fn(),
    verifyIdentityNumber: jest.fn(),
    beginBAITSKeeperIDVerification: jest.fn(),
    finishBAITSKeeperIDVerification: jest.fn(),
    setFirebaseTokenId: jest.fn(),
    getUserReport: jest.fn(),
    createAuctionApprover: jest.fn(),
    getAuctionApproversForSeller: jest.fn(),
    updateAuctionApproverStatus: jest.fn(),
    deleteUser: jest.fn(),
  },
}));

jest.mock('../../../src/shared/keycloak', () => ({
  resetKeycloakUserPassword: jest.fn(),
}));

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import userService from '../../../src/services/user-service';
import { resetKeycloakUserPassword } from '../../../src/shared/keycloak';
import userRouter, { p } from '../../../src/routes/user-router';
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
  app.use(userRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();
const USER_ID = new Types.ObjectId().toHexString();
const APPROVER_ID = new Types.ObjectId().toHexString();
const STUB_USER = { _id: USER_ID, email: 'test@example.com' };
const STUB_SELLER = { email: 'seller@test.com', name: 'Test Seller', phone: '+267 71234567' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('user-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildBidder(), _id: new Types.ObjectId(), id: new Types.ObjectId().toHexString(), keycloakId: 'kc-123' };
    injectPermissions = Object.values(EPermission).filter(p => p.startsWith('user:'));
  });

  // ─── GET /getUserById ─────────────────────────────────────────────────────

  describe('GET /getUserById', () => {
    it('returns 200 with user on happy path', async () => {
      (userService.getById as jest.Mock).mockResolvedValue(STUB_USER);
      const res = await request(app).get(p.getUserById).query({ id: USER_ID });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ _id: USER_ID });
    });

    it('returns 401 when USER_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getUserById).query({ id: USER_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when id query param is missing', async () => {
      const res = await request(app).get(p.getUserById).query({});
      expect(res.status).toBe(400);
    });

    it('propagates NotFoundError as 404', async () => {
      (userService.getById as jest.Mock).mockRejectedValue(new NotFoundError('User not found'));
      const res = await request(app).get(p.getUserById).query({ id: USER_ID });
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /getOwnAccount ───────────────────────────────────────────────────

  describe('GET /getOwnAccount', () => {
    it('returns 200 with own user account', async () => {
      (userService.getById as jest.Mock).mockResolvedValue(STUB_USER);
      const res = await request(app).get(p.getOwnAccount);
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
    });
  });

  // ─── POST /createSeller ───────────────────────────────────────────────────

  describe('POST /createSeller', () => {
    it('returns 201 with created seller on happy path', async () => {
      (userService.createSeller as jest.Mock).mockResolvedValue({ ...STUB_SELLER, _id: new Types.ObjectId() });
      const res = await request(app).post(p.createSeller).send(STUB_SELLER);
      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
    });

    it('returns 401 when USER_MANAGE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.createSeller).send(STUB_SELLER);
      expect(res.status).toBe(401);
    });

    it('returns 400 when email is missing', async () => {
      const { email: _, ...body } = STUB_SELLER;
      const res = await request(app).post(p.createSeller).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
      const { name: _, ...body } = STUB_SELLER;
      const res = await request(app).post(p.createSeller).send(body);
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /updatePassword ─────────────────────────────────────────────────

  describe('PUT /updatePassword', () => {
    it('returns 200 with success message on happy path', async () => {
      (resetKeycloakUserPassword as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).put(p.updatePassword).send({ newPassword: 'NewPass123!' });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password updated successfully');
    });

    it('returns 400 when newPassword is missing', async () => {
      const res = await request(app).put(p.updatePassword).send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 when newPassword is shorter than 8 characters', async () => {
      const res = await request(app).put(p.updatePassword).send({ newPassword: 'short' });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /setFirebaseTokenId ─────────────────────────────────────────────

  describe('PUT /setFirebaseTokenId', () => {
    it('returns 200 on happy path', async () => {
      (userService.setFirebaseTokenId as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).put(p.setFirebaseTokenId).send({ tokenId: 'fcm-token-abc' });
      expect(res.status).toBe(200);
    });

    it('returns 400 when tokenId is missing', async () => {
      const res = await request(app).put(p.setFirebaseTokenId).send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getUserReport ───────────────────────────────────────────────────

  describe('GET /getUserReport', () => {
    it('returns 200 with report on happy path', async () => {
      (userService.getUserReport as jest.Mock).mockResolvedValue({ total: 10, bidders: 8, sellers: 2 });
      const res = await request(app).get(p.getUserReport);
      expect(res.status).toBe(200);
      expect(res.body.report).toBeDefined();
    });

    it('returns 401 when USER_REPORT permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getUserReport);
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /createAuctionApprover ─────────────────────────────────────────

  describe('POST /createAuctionApprover', () => {
    const VALID_BODY = { email: 'approver@test.com', firstName: 'Jane', lastName: 'Doe' };

    it('returns 201 with approver on happy path', async () => {
      (userService.createAuctionApprover as jest.Mock).mockResolvedValue({ ...VALID_BODY, _id: new Types.ObjectId() });
      const res = await request(app).post(p.createAuctionApprover).send(VALID_BODY);
      expect(res.status).toBe(201);
      expect(res.body.approver).toBeDefined();
    });

    it('returns 401 when USER_APPROVER_MANAGE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).post(p.createAuctionApprover).send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when firstName is missing', async () => {
      const { firstName: _, ...body } = VALID_BODY;
      const res = await request(app).post(p.createAuctionApprover).send(body);
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getAuctionApprovers ─────────────────────────────────────────────

  describe('GET /getAuctionApprovers', () => {
    it('returns 200 with approvers array on happy path', async () => {
      (userService.getAuctionApproversForSeller as jest.Mock).mockResolvedValue([]);
      const res = await request(app).get(p.getAuctionApprovers);
      expect(res.status).toBe(200);
      expect(res.body.approvers).toBeDefined();
    });

    it('returns 401 when USER_APPROVER_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getAuctionApprovers);
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /updateAuctionApproverStatus ────────────────────────────────────

  describe('PUT /updateAuctionApproverStatus', () => {
    const VALID_BODY = { approverId: APPROVER_ID, isActive: true };

    it('returns 200 with updated approver on happy path', async () => {
      (userService.updateAuctionApproverStatus as jest.Mock).mockResolvedValue({ _id: APPROVER_ID, isActive: true });
      const res = await request(app).put(p.updateAuctionApproverStatus).send(VALID_BODY);
      expect(res.status).toBe(200);
    });

    it('returns 401 when USER_APPROVER_MANAGE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).put(p.updateAuctionApproverStatus).send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when isActive is missing', async () => {
      const res = await request(app).put(p.updateAuctionApproverStatus).send({ approverId: APPROVER_ID });
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /deleteAdminById ─────────────────────────────────────────────

  describe('DELETE /deleteAdminById', () => {
    it('returns 200 with success message on happy path', async () => {
      (userService.deleteUser as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).delete(p.deleteAdminById).query({ id: USER_ID });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Admin deleted');
    });

    it('returns 401 when USER_DELETE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).delete(p.deleteAdminById).query({ id: USER_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when id is missing', async () => {
      const res = await request(app).delete(p.deleteAdminById).query({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getUsers ────────────────────────────────────────────────────────

  describe('GET /getUsers', () => {
    const VALID_QUERY = { sortOrder: 'asc', sortBy: 'DATE', limit: '20' };

    it('returns 200 with users array on happy path', async () => {
      (userService.getUsers as jest.Mock).mockResolvedValue([STUB_USER]);
      const res = await request(app).get(p.getUsers).query(VALID_QUERY);
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
    });

    it('returns 401 when USER_MANAGE permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getUsers).query(VALID_QUERY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder is missing', async () => {
      const { sortOrder: _, ...q } = VALID_QUERY;
      const res = await request(app).get(p.getUsers).query(q);
      expect(res.status).toBe(400);
    });
  });
});
