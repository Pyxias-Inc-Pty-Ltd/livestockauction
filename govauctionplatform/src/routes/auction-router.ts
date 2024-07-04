import itemService from '../services/item-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoDateValidation, isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { BidderOnly, SuperAdminOnly } from '../shared/middleware';
import { IAdmin } from '../models/user-model';
import { EAuctionSortType, EItemStatus, ESortOrderType } from '../globals';
import auctionService from '../services/auction-service';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createAuction: '/createAuction',
  deleteAuction: '/deleteAuction'
} as const;

/**
 * Create an auction
 */
router.post(p.createAuction, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      title: Joi.string().required().messages({
        'any.required': '"title" is a required field'
      }),
      auctionNumber: Joi.string().required().messages({
        'any.required': '"auctionNumber" is a required field'
      }),
      auctionLocation: Joi.string().required().messages({
        'any.required': '"auctionLocation" is a required field'
      }),
      terms: Joi.string().required().messages({
        'any.required': '"terms" is a required field'
      }),
      categoryId: mongoIdValidation.required().messages({
        'any.required': '"categoryId" is a required field'
      }),
      startTime: isoDateValidation.required().messages({
        'any.required': '"startTime" is a required field'
      }),
      endTime: isoDateValidation.required().messages({
        'any.required': '"endTime" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const auction = await auctionService.createAuction(req.user as IAdmin, req.body as any);
    return res.status(CREATED).json({auction});
  } catch (error) {
    throw error;
  }
});

/**
 * Delete an auction
 */
router.delete(p.deleteAuction, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {

    // Query checks
    const qSchema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field'
      })
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { auctionId } = req.query;

    await auctionService.deleteAuction(req.user as IAdmin, auctionId as string);

    return res.status(OK).json({"message": "OK"});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;