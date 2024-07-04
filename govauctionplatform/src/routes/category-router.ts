import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { SuperAdminOnly } from '../shared/middleware';
import categoryService from '@services/category-service';

// Constants
const router = Router();
const { CREATED, OK } = StatusCodes;

// Paths
export const p = {
  createCategory: '/createCategory'
} as const;

/**
 * Create a category
 */
router.post(p.createCategory, SuperAdminOnly(), async (req: Request, res: Response) => {
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

// Export default
export default router;