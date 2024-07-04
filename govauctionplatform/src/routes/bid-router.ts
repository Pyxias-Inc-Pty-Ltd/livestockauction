import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { BidderOnly } from '../shared/middleware';
import bidService from '../services/bid-service';
import { EBidSortType, ESortOrderType } from '../globals';

// Constants
const router = Router();
const { CREATED, OK } = StatusCodes;

// Paths
export const p = {
  // createBid: '/createBid',
  getBids: '/getBids'
} as const;

// /**
//  * Create a bid
//  */
// router.post(p.createBid, BidderOnly(), async (req: Request, res: Response) => {
//   try {
//     const schema = Joi.object().keys({
//       itemId: mongoIdValidation.required().messages({
//         'any.required': '"itemId" is a required field'
//       }),
//       bidAmount: Joi.number().greater(0).required().messages({
//         'any.required': '"bidAmount" is a required field'
//       })
//     }).required(); // TODO: Check if start date preceeds end date
    
//     // Validate schema against input
//     Joi.assert(req.body, schema);

//     const item = await bidService.createBid(req.user as IBidder, req.body as any);
//     return res.status(CREATED).json({item});
//   } catch (error) {
//     throw error;
//   }
// });

/**
 * Get bids.
 */
router.get(p.getBids, BidderOnly(), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EBidSortType.DATE, EBidSortType.AMOUNT).messages({
        'any.required': '"sortBy" is a required field'
      }),
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, itemId } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);
    conditions.set('itemId', itemId);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    const bids = await bidService.getBids(conditions);
    return res.status(OK).json({bids});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;