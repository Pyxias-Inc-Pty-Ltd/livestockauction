/**
 * Integration tests for src/routes/form-router.ts
 *
 * Strategy: mock middleware (requirePermission) and formService so tests focus
 * on route-level permission enforcement and Joi validation, not business logic.
 *
 * Permission model:
 *   FORM_READ   → GET /getFormById, GET /getFormsBySeller
 *   FORM_MANAGE → POST /createForm, PUT /updateForm, DELETE /deleteForm, GET /getForms
 */

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

jest.mock('../../../src/shared/middleware', () => {
  const { UnauthorizedError } = jest.requireActual('../../../src/shared/errors');
  return {
    requirePermission: (...perms: string[]) => (req: any, _res: any, next: any) => {
      const missing = perms.filter((p: string) => !(req.permissions ?? []).includes(p));
      if (missing.length > 0) return next(new UnauthorizedError(`Missing: ${missing.join(', ')}`));
      next();
    },
    deserializeUser: (_req: any, _res: any, next: any) => next(),
  };
});

jest.mock('../../../src/services/form-service', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
    createForm: jest.fn(),
    updateForm: jest.fn(),
    deleteForm: jest.fn(),
    getFormsBySeller: jest.fn(),
    getForms: jest.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { Types } from 'mongoose';
import formService from '../../../src/services/form-service';
import formRouter, { p } from '../../../src/routes/form-router';
import { CustomError } from '../../../src/shared/errors';
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
  app.use(formRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildApp();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FORM_ID    = new Types.ObjectId().toHexString();
const SELLER_ID  = new Types.ObjectId().toHexString();
const CATEGORY_ID = new Types.ObjectId().toHexString();

const STUB_FORM = {
  _id: FORM_ID,
  identificationNumber: 'FORM-001',
  sellerId: SELLER_ID,
  description: 'A test form',
};

const VALID_CREATE_BODY = {
  identificationNumber: 'FORM-001',
  sellerId: SELLER_ID,
  categoryId: CATEGORY_ID,
  description: 'A test form',
  formAttributes: {
    title: 'Test Form',
    sections: [],
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('form-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser = { ...buildAdmin(), id: new Types.ObjectId().toHexString() };
    // Start each test with both permissions granted
    injectPermissions = [EPermission.FORM_READ, EPermission.FORM_MANAGE];
  });

  // ─── GET /getFormById ─────────────────────────────────────────────────────

  describe(`GET ${p.getFormById}`, () => {
    it('returns 200 with the form on happy path', async () => {
      (formService.getById as jest.Mock).mockResolvedValue(STUB_FORM);
      const res = await request(app).get(p.getFormById).query({ id: FORM_ID });
      expect(res.status).toBe(200);
      expect(res.body.form).toBeDefined();
    });

    it('passes the id query param to formService.getById', async () => {
      (formService.getById as jest.Mock).mockResolvedValue(STUB_FORM);
      await request(app).get(p.getFormById).query({ id: FORM_ID });
      expect(formService.getById).toHaveBeenCalledWith(FORM_ID);
    });

    it('returns 401 when FORM_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getFormById).query({ id: FORM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when id is not a valid MongoId', async () => {
      const res = await request(app).get(p.getFormById).query({ id: 'not-a-mongo-id' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when id query param is absent', async () => {
      const res = await request(app).get(p.getFormById);
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /createForm ────────────────────────────────────────────────────

  describe(`POST ${p.createForm}`, () => {
    it('returns 201 with the new form on happy path', async () => {
      (formService.createForm as jest.Mock).mockResolvedValue(STUB_FORM);
      const res = await request(app).post(p.createForm).send(VALID_CREATE_BODY);
      expect(res.status).toBe(201);
      expect(res.body.form).toBeDefined();
    });

    it('passes req.user and body to formService.createForm', async () => {
      (formService.createForm as jest.Mock).mockResolvedValue(STUB_FORM);
      await request(app).post(p.createForm).send(VALID_CREATE_BODY);
      expect(formService.createForm).toHaveBeenCalledWith(
        injectUser,
        expect.objectContaining({ identificationNumber: 'FORM-001' }),
      );
    });

    it('returns 401 when FORM_MANAGE permission is missing', async () => {
      injectPermissions = [EPermission.FORM_READ]; // READ only, not MANAGE
      const res = await request(app).post(p.createForm).send(VALID_CREATE_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 400 when identificationNumber is missing', async () => {
      const { identificationNumber: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createForm).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when sellerId is not a valid MongoId', async () => {
      const res = await request(app)
        .post(p.createForm)
        .send({ ...VALID_CREATE_BODY, sellerId: 'bad-id' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when formAttributes is missing', async () => {
      const { formAttributes: _, ...body } = VALID_CREATE_BODY;
      const res = await request(app).post(p.createForm).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when formAttributes.title is missing', async () => {
      const res = await request(app).post(p.createForm).send({
        ...VALID_CREATE_BODY,
        formAttributes: { sections: [] },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /updateForm ─────────────────────────────────────────────────────

  describe(`PUT ${p.updateForm}`, () => {
    it('returns 200 with updated form on happy path', async () => {
      (formService.updateForm as jest.Mock).mockResolvedValue(STUB_FORM);
      const res = await request(app).put(p.updateForm).send({
        formId: FORM_ID,
        description: 'Updated description',
      });
      expect(res.status).toBe(200);
      expect(res.body.form).toBeDefined();
    });

    it('returns 401 when FORM_MANAGE permission is missing', async () => {
      injectPermissions = [EPermission.FORM_READ];
      const res = await request(app).put(p.updateForm).send({ formId: FORM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when formId is not a valid MongoId', async () => {
      const res = await request(app).put(p.updateForm).send({ formId: 'bad-id' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when formId is absent', async () => {
      const res = await request(app).put(p.updateForm).send({ description: 'no id' });
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /deleteForm ───────────────────────────────────────────────────

  describe(`DELETE ${p.deleteForm}`, () => {
    it('returns 200 with success message on happy path', async () => {
      (formService.deleteForm as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).delete(p.deleteForm).send({ formId: FORM_ID });
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });

    it('returns 401 when FORM_MANAGE permission is missing', async () => {
      injectPermissions = [EPermission.FORM_READ];
      const res = await request(app).delete(p.deleteForm).send({ formId: FORM_ID });
      expect(res.status).toBe(401);
    });

    it('returns 400 when formId is absent', async () => {
      const res = await request(app).delete(p.deleteForm).send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 when formId is not a valid MongoId', async () => {
      const res = await request(app).delete(p.deleteForm).send({ formId: 'not-valid' });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /getFormsBySeller ────────────────────────────────────────────────

  describe(`GET ${p.getFormsBySeller}`, () => {
    it('returns 200 with forms array on happy path', async () => {
      (formService.getFormsBySeller as jest.Mock).mockResolvedValue([STUB_FORM]);
      const res = await request(app).get(p.getFormsBySeller);
      expect(res.status).toBe(200);
      expect(res.body.forms).toHaveLength(1);
    });

    it('passes req.user to formService.getFormsBySeller', async () => {
      (formService.getFormsBySeller as jest.Mock).mockResolvedValue([]);
      await request(app).get(p.getFormsBySeller);
      expect(formService.getFormsBySeller).toHaveBeenCalledWith(injectUser);
    });

    it('returns 401 when FORM_READ permission is missing', async () => {
      injectPermissions = [];
      const res = await request(app).get(p.getFormsBySeller);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /getForms ────────────────────────────────────────────────────────

  describe(`GET ${p.getForms}`, () => {
    it('returns 200 with forms on happy path', async () => {
      (formService.getForms as jest.Mock).mockResolvedValue([STUB_FORM]);
      const res = await request(app).get(p.getForms);
      expect(res.status).toBe(200);
      expect(res.body.forms).toHaveLength(1);
    });

    it('returns 401 when FORM_MANAGE permission is missing (FORM_READ alone is insufficient)', async () => {
      injectPermissions = [EPermission.FORM_READ];
      const res = await request(app).get(p.getForms);
      expect(res.status).toBe(401);
    });

    it('returns 400 when sortOrder is an invalid value', async () => {
      const res = await request(app).get(p.getForms).query({ sortOrder: 'INVALID' });
      expect(res.status).toBe(400);
    });

    it('accepts valid sortOrder values', async () => {
      (formService.getForms as jest.Mock).mockResolvedValue([]);
      const res = await request(app).get(p.getForms).query({ sortOrder: 'ASC' });
      expect(res.status).toBe(200);
    });

    it('returns 400 when lastDocumentId is not a valid MongoId', async () => {
      const res = await request(app)
        .get(p.getForms)
        .query({ lastDocumentId: 'not-a-valid-id' });
      expect(res.status).toBe(400);
    });
  });
});
