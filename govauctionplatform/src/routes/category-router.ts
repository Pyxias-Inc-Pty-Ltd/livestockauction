import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { requirePermission } from '../shared/middleware';
import { EPermission } from '../globals';
import categoryService from '@services/category-service';
import { mongoIdValidation } from '../shared/functions';

// Constants
const router = Router();
const { CREATED, OK } = StatusCodes;

// Paths
export const p = {
  createCategory: '/createCategory',
  getCategories: '/getCategories',
  getCategoryById: '/getCategoryById'
} as const;

/**
 * Create a category
 */
router.post(p.createCategory, requirePermission(EPermission.AUCTION_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      name: Joi.string().required().messages({
        'any.required': '"name" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const category = await categoryService.createCategory(req.body as any);
    return res.status(CREATED).json({category});
  } catch (error) {
    throw error;
  }
});

/**
 * Get all categories
 */
router.get(p.getCategories, requirePermission(EPermission.AUCTION_MANAGE), async (req: Request, res: Response) => {
  try {
    const categories = await categoryService.getCategories();
    return res.status(OK).json({ categories });
  } catch (error) {
    throw error;
  }
});

/**
 * Get category by id
 */
router.get(p.getCategoryById, requirePermission(EPermission.AUCTION_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      id: mongoIdValidation.required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    Joi.assert(req.query, schema);

    const { id } = req.query;
    const category = await categoryService.getById(id as string);
    return res.status(OK).json({ category });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;