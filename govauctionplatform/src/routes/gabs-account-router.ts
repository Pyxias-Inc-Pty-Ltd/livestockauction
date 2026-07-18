import { requirePermission } from '../shared/middleware';
import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import { mongoIdValidation } from '../shared/functions';
import { EPermission } from '../globals';
import gabsAccountService from '../services/gabs-account-service';

const router = Router();
const { OK, CREATED } = StatusCodes;

export const p = {
  getBySeller: '/getBySeller',
  create: '/create',
  update: '/update',
  delete: '/delete',
} as const;

// List GABS accounts for a seller
router.get(p.getBySeller, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
  const schema = Joi.object({
    sellerId: mongoIdValidation.required(),
  }).required();

  Joi.assert(req.query, schema);

  const { sellerId } = req.query;
  const accounts = await gabsAccountService.getBySellerId(sellerId as string);
  return res.status(OK).json({ accounts });
});

// Create a GABS account
router.post(p.create, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
  const schema = Joi.object({
    sellerId: mongoIdValidation.required(),
    ministry: Joi.string().required().trim(),
    department: Joi.string().required().trim(),
    parentAccount: Joi.string().required().trim(),
    accountNumber: Joi.string().required().trim(),
    accountName: Joi.string().required().trim(),
  }).required();

  Joi.assert(req.body, schema);

  const { sellerId, ministry, department, parentAccount, accountNumber, accountName } = req.body;
  const account = await gabsAccountService.create(sellerId, ministry, department, parentAccount, accountNumber, accountName);
  return res.status(CREATED).json({ account });
});

// Update a GABS account
router.put(p.update, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
  const schema = Joi.object({
    id: mongoIdValidation.required(),
    ministry: Joi.string().trim().optional(),
    department: Joi.string().trim().optional(),
    parentAccount: Joi.string().trim().optional(),
    accountNumber: Joi.string().trim().optional(),
    accountName: Joi.string().trim().optional(),
  }).required();

  Joi.assert(req.body, schema);

  const { id, ...data } = req.body;
  const account = await gabsAccountService.update(id, data);

  if (!account) {
    return res.status(StatusCodes.NOT_FOUND).json({ message: 'GABS account not found' });
  }

  return res.status(OK).json({ account });
});

// Delete a GABS account
router.delete(p.delete, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
  const schema = Joi.object({
    id: mongoIdValidation.required(),
  }).required();

  Joi.assert(req.body, schema);

  const { id } = req.body;
  const account = await gabsAccountService.remove(id);

  if (!account) {
    return res.status(StatusCodes.NOT_FOUND).json({ message: 'GABS account not found' });
  }

  return res.status(OK).json({ message: 'GABS account deleted' });
});

export default router;
