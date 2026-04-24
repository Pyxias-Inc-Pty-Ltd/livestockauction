import itemService from '../services/item-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoDateValidation, mongoIdValidation, urlValidation } from '../shared/functions';
import { requirePermission } from '../shared/middleware';
import { IAdmin, IBidder } from '../models/user-model';
import { EItemSortType, EPermission, ESortOrderType, MAX_LIST_LIMIT_NUMBER } from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createItem: '/createItem',
  setWinningBidder: '/setWinningBidder',
  deleteItem: '/deleteItem',
  setNewBidAmountManually: '/setNewBidAmountManually',
  getManualBidAmount: '/getManualBidAmount',
  getItemsWon: '/getItemsWon',
  getEligibleBidders: '/getEligibleBidders'
} as const;

/**
 * Get items won by the bidder.
 */
router.get(p.getItemsWon, requirePermission(EPermission.LOT_READ), async (req: Request, res: Response) => {
  try {
    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EItemSortType.DATE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT_NUMBER).required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    const items = await itemService.getItemsWon(req.user as IBidder, conditions);
    return res.status(OK).json({items});
  } catch (error) {
    throw error;
  }
});

/**
 * Create an item
 */
router.post(p.createItem, requirePermission(EPermission.LOT_CREATE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      formId: mongoIdValidation.required().messages({
        'any.required': '"formId" is a required field'
      }),
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field'
      }),
      sellerId: mongoIdValidation.required().messages({
        'any.required': '"sellerId" is a required field'
      }),
      gallery: Joi.array().items(urlValidation).required().messages({
        'any.required': '"gallery" is a required field'
      }),
      title: Joi.object().keys({
        en: Joi.string().required().messages({
          'any.required': '"title.en" is a required field'
        }),
        tn: Joi.string().required().messages({
          'any.required': '"title.tn" is a required field'
        }), 
      }).required().messages({
        'any.required': '"title" is a required field'
      }),
      description: Joi.object().keys({
        en: Joi.string().required().messages({
          'any.required': '"description.en" is a required field'
        }),
        tn: Joi.string().required().messages({
          'any.required': '"description.tn" is a required field'
        }), 
      }).required().messages({
        'any.required': '"description" is a required field'
      }),
      terms: Joi.object().keys({
        en: Joi.string().required().messages({
          'any.required': '"terms.en" is a required field'
        }),
        tn: Joi.string().required().messages({
          'any.required': '"terms.tn" is a required field'
        }), 
      }).required().messages({
        'any.required': '"terms" is a required field'
      }),
      startingBid: Joi.number().required().messages({
        'any.required': '"startingBid" is a required field'
      }),
      reservePrice: Joi.number().required().messages({
        'any.required': '"reservePrice" is a required field'
      }),
      buyoutPrice: Joi.number(),
      isClosedBidding: Joi.boolean().default(false),
      isBidIncrementedManually: Joi.boolean().required().when('isClosedBidding', {
        is: true,
        then: Joi.valid(false).messages({
          'any.only': 'isBidIncrementedManually must be false when isClosedBidding is true'
        }),
        otherwise: Joi.boolean().required()
      }).messages({
        'any.required': '"isBidIncrementedManually" is a required field'
      }),
      bidIncrement: Joi.number().when('isBidIncrementedManually', {
        is: false,
        then: Joi.required().messages({
          'any.required': '"bidIncrement" is a required field'
        }),
        otherwise: Joi.optional()
      }),
      startTime: isoDateValidation.required().messages({
        'any.required': '"startTime" is a required field'
      }),
      endTime: isoDateValidation.required().messages({
        'any.required': '"endTime" is a required field'
      }),
      metadata: Joi.object().keys({
        categoryId: mongoIdValidation,
        isLivestock: Joi.boolean(),
        isAStud: Joi.boolean().when('isLivestock', {
          is: true,
          then: Joi.required().messages({
            'any.required': '"metadata.isAStud" is a required field'
          }),
          otherwise: Joi.optional()
        }),
        studRegistrationNumber: Joi.string().when('isAStud', {
          is: true,
          then: Joi.required().messages({
            'any.required': '"metadata.studRegistrationNumber" is a required field'
          }),
          otherwise: Joi.optional()
        }),
        numberOfCalvesBorn: Joi.number().min(0),
        animalEID: Joi.string().when('isLivestock', {
          is: true,
          then: Joi.required().messages({
            'any.required': '"metadata.animalEID" is a required field'
          }),
          otherwise: Joi.optional()
        }),
        machineType: Joi.string(),
        make: Joi.string(),
        model: Joi.string(),
        year: Joi.string().isoDate(),
        serialNumber: Joi.string(),
        condition: Joi.string(),
        hoursUsed: Joi.number().min(0),
        power: Joi.number().min(0),
        mileage: Joi.number().min(0),
        engineNumber: Joi.string(),
        chassisNumber: Joi.string(),
        registrationNumber: Joi.string(),
        colour: Joi.string(),
        isOperational: Joi.boolean()
      }).required().messages({
        'any.required': '"metadata" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const item = await itemService.createItem(req.user as IAdmin, req.body as any);
    return res.status(CREATED).json({item});
  } catch (error) {
    throw error;
  }
});

/**
 * Set the winning bidder
 */
router.put(p.setWinningBidder, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      bidderId: mongoIdValidation.required().messages({
        'any.required': '"bidderId" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const item = await itemService.setWinningBidder(req.body as any);
    return res.status(CREATED).json({item});
  } catch (error) {
    throw error;
  }
});

/**
 * Delete an item
 */
router.delete(p.deleteItem, requirePermission(EPermission.LOT_MANAGE), async (req: Request, res: Response) => {
  try {

    // Query checks
    const qSchema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      })
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { itemId } = req.query;

    await itemService.deleteItem(req.user as IAdmin, itemId as string);

    return res.status(OK).json({"message": "OK"});
  } catch (error) {
    throw error;
  }
});

// /**
//  * Set new bid amount manually
//  */
// router.put(p.setNewBidAmountManually, SuperAdminOnly(), async (req: Request, res: Response) => {
//   try {
//     const schema = Joi.object().keys({
//       itemId: mongoIdValidation.required().messages({
//         'any.required': '"itemId" is a required field'
//       }),
//       amount: Joi.number().required().messages({
//         'any.required': '"amount" is a required field'
//       })
//     }).required();
    
//     // Validate schema against input
//     Joi.assert(req.body, schema);

//     const item = await itemService.setNewBidAmountManually(req.body as any);
//     return res.status(OK).json({ item });
//   } catch (error) {
//     throw error;
//   }
// });

/**
 * Get manual bid amount
 */
router.get(p.getManualBidAmount, requirePermission(EPermission.LOT_BID_READ), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.query, schema);

    const { itemId } = req.query;

    const manualBidAmount = await itemService.getManualBidAmount(itemId as string);
    return res.status(OK).json({ manualBidAmount });
  } catch (error) {
    throw error;
  }
});

/**
 * Get eligible bidders for an item
 */
router.get('/getEligibleBidders', async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      })
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { itemId } = req.query;

    const eligibleBidders = await itemService.getEligibleBidders(itemId as string);
    return res.status(OK).json({ eligibleBidders });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;