import itemService from '../services/item-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoDateValidation, mongoIdValidation, urlValidation } from '../shared/functions';
import { SuperAdminOnly, BidderOnly } from '../shared/middleware';
import { IAdmin } from '../models/user-model';
import { EGenderType } from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createItem: '/createItem',
  setWinningBidder: '/setWinningBidder',
  deleteItem: '/deleteItem',
  setNewBidAmountManually: '/setNewBidAmountManually',
  getManualBidAmount: '/getManualBidAmount'
} as const;

/**
 * Create an item
 */
router.post(p.createItem, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field'
      }),
      sellerId: mongoIdValidation.required().messages({
        'any.required': '"sellerId" is a required field'
      }),
      gallery: Joi.array().items(urlValidation).required().messages({
        'any.required': '"gallery" is a required field'
      }),
      title: Joi.string().required().messages({
        'any.required': '"title" is a required field'
      }),
      description: Joi.string().required().messages({
        'any.required': '"description" is a required field'
      }),
      terms: Joi.string().required().messages({
        'any.required': '"terms" is a required field'
      }),
      startingBid: Joi.number().required().messages({
        'any.required': '"startingBid" is a required field'
      }),
      reservePrice: Joi.number().required().messages({
        'any.required': '"reservePrice" is a required field'
      }),
      buyoutPrice: Joi.number(),
      isBidIncrementedManually: Joi.boolean().required().messages({
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
      isLivestock: Joi.boolean().required().messages({
        'any.required': '"isLivestock" is a required field'
      }),
      dob: Joi.string().isoDate(),
      gender: Joi.string().valid(EGenderType.FEMALE, EGenderType.MALE, EGenderType.MIXED).when('isLivestock', {
        is: true,
        then: Joi.required().messages({
          'any.required': '"gender" is a required field'
        }),
        otherwise: Joi.optional()
      }),
      breedId: mongoIdValidation.when('isLivestock', {
        is: true,
        then: Joi.required().messages({
          'any.required': '"breedId" is a required field'
        }),
        otherwise: Joi.optional()
      }),
      isAStud: Joi.boolean().when('isLivestock', {
        is: true,
        then: Joi.required().messages({
          'any.required': '"isAStud" is a required field'
        }),
        otherwise: Joi.optional()
      }),
      numberOfCalvesBorn: Joi.number().min(0),
      studRegistrationNumber: Joi.string().when('isAStud', {
        is: true,
        then: Joi.required().messages({
          'any.required': '"studRegistrationNumber" is a required field'
        }),
        otherwise: Joi.optional()
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
router.delete(p.deleteItem, SuperAdminOnly(), async (req: Request, res: Response) => {
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

/**
 * Set new bid amount manually
 */
router.put(p.setNewBidAmountManually, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      amount: Joi.number().required().messages({
        'any.required': '"amount" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const item = await itemService.setNewBidAmountManually(req.body as any);
    return res.status(OK).json({ item });
  } catch (error) {
    throw error;
  }
});

/**
 * Get manual bid amount
 */
router.get(p.getManualBidAmount, SuperAdminOnly(), BidderOnly(), async (req: Request, res: Response) => {
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

// Export default
export default router;