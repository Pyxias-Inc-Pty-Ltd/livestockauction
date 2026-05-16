import itemService from '../services/item-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoDateValidation, mongoIdValidation, urlValidation } from '../shared/functions';
import { requirePermission, SellerOnly, BidderOnly } from '../shared/middleware';
import { IAdmin, IBidder, ISeller } from '../models/user-model';
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
  getEligibleBidders: '/getEligibleBidders',
  addInvitedBidders: '/addInvitedBidders',
  removeInvitedBidder: '/removeInvitedBidder',
  getInvitedBidders: '/getInvitedBidders',
  isInvited: '/isInvited',
  updateItem: '/updateItem',
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
        en: Joi.string().allow('').optional(),
        tn: Joi.string().allow('').optional(),
      }).optional(),
      startingBid: Joi.number().required().messages({
        'any.required': '"startingBid" is a required field'
      }),
      reservePrice: Joi.number().required().messages({
        'any.required': '"reservePrice" is a required field'
      }),
      buyoutPrice: Joi.number().allow(null).optional(),
      isBeingLivestreamed: Joi.boolean().default(false),
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
        breed: Joi.string(),
        gender: Joi.string(),
        birthType: Joi.string(),
        parentMale: Joi.string(),
        parentFemale: Joi.string(),
        birthWeight: Joi.number().min(0),
        weaningWeight: Joi.number().min(0),
        dob: Joi.string().isoDate(),
        machineType: Joi.string(),
        make: Joi.string(),
        model: Joi.string(),
        year: Joi.string().isoDate(),
        serialNumber: Joi.string(),
        condition: Joi.string(),
        hoursUsed: Joi.number().min(0),
        power: Joi.number().min(0),
        mileage: Joi.number().min(0),
        age: Joi.number().min(0),
        engineNumber: Joi.string(),
        transmission: Joi.string(),
        fuelType: Joi.string(),
        chassisNumber: Joi.string(),
        registrationNumber: Joi.string(),
        colour: Joi.string(),
        isOperational: Joi.boolean(),
        plotNumber: Joi.string(),
        plotSize: Joi.number().min(0),
        locationText: Joi.string(),
        titleDeedOrTribalLeaseNumber: Joi.string(),
      }).required().messages({
        'any.required': '"metadata" is a required field'
      }),
      invitedBidders: Joi.array().items(mongoIdValidation).default([]),
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
 * Update an item (seller only, NOT_BEGUN status only)
 */
router.put(p.updateItem, SellerOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      gallery: Joi.array().items(urlValidation).optional(),
      title: Joi.object().keys({
        en: Joi.string().required(),
        tn: Joi.string().required(),
      }).optional(),
      description: Joi.object().keys({
        en: Joi.string().required(),
        tn: Joi.string().required(),
      }).optional(),
      terms: Joi.object().keys({
        en: Joi.string().allow('').optional(),
        tn: Joi.string().allow('').optional(),
      }).optional(),
      startingBid: Joi.number().optional(),
      reservePrice: Joi.number().optional(),
      buyoutPrice: Joi.number().allow(null).optional(),
      startTime: isoDateValidation.optional(),
      endTime: isoDateValidation.optional(),
      metadata: Joi.object().optional(),
    }).required();

    Joi.assert(req.body, schema);

    const { itemId, ...updateData } = req.body;
    const item = await itemService.updateItem(req.user as ISeller, itemId, updateData);
    return res.status(OK).json({ item });
  } catch (error) {
    throw error;
  }
});

/**
 * Set the winning bidder
 */
router.put(p.setWinningBidder, requirePermission(EPermission.LOT_MANAGE), async (req: Request, res: Response) => {
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

/**
 * Add invited bidders to an item.
 */
router.post(p.addInvitedBidders, requirePermission(EPermission.LOT_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field',
      }),
      bidderIds: Joi.array().items(mongoIdValidation).min(1).required().messages({
        'any.required': '"bidderIds" is a required field',
      }),
    }).required();

    Joi.assert(req.body, schema);

    const { itemId, bidderIds } = req.body;
    const item = await itemService.addInvitedBidders(itemId, bidderIds);
    return res.status(OK).json({ item });
  } catch (error) {
    throw error;
  }
});

/**
 * Remove an invited bidder from an item.
 */
router.post(p.removeInvitedBidder, requirePermission(EPermission.LOT_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field',
      }),
      bidderId: mongoIdValidation.required().messages({
        'any.required': '"bidderId" is a required field',
      }),
    }).required();

    Joi.assert(req.body, schema);

    const { itemId, bidderId } = req.body;
    const item = await itemService.removeInvitedBidder(itemId, bidderId);
    return res.status(OK).json({ item });
  } catch (error) {
    throw error;
  }
});

/**
 * Get invited bidders for an item with full details.
 */
router.get(p.getInvitedBidders, async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field',
      }),
    }).required();

    Joi.assert(req.query, qSchema);

    const { itemId } = req.query;
    const bidders = await itemService.getInvitedBidders(itemId as string);
    return res.status(OK).json({ bidders });
  } catch (error) {
    throw error;
  }
});

/**
 * Check whether the currently authenticated bidder is invited to a lot.
 * Returns { invited: boolean } without exposing the full invited list.
 */
router.get(p.isInvited, BidderOnly(), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field',
      }),
    }).required();

    Joi.assert(req.query, qSchema);

    const { itemId } = req.query;
    const userId = (req.user as IBidder).id.toString();
    const invited = await itemService.isInvited(itemId as string, userId);
    return res.status(OK).json({ invited });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;