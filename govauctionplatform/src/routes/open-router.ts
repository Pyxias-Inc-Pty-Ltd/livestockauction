import userService from '../services/user-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoAlpha2CountryValidation, isoAlpha3CurrencyValidation, isStringNumberLike, mongoIdValidation, phoneValidation } from '../shared/functions';
import transactionService from '../services/transaction-service';
import auctionService from '../services/auction-service';
import categoryService from '../services/category-service';
import itemService from '../services/item-service';
import breedService from '../services/breed-service';
import {
  ESortOrderType,
  EAuctionSortType,
  EItemStatus,
  EItemSortType,
  EUniPayPaymentStatus,
  EGenderType,
  EAuctionStatus
} from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createInitAdmin: '/createInitAdmin',
  processSuccessfulPaymentFromTingg: '/processSuccessfulPaymentFromTingg',
  processSuccessfulPaymentFromUniPay: '/processSuccessfulPaymentFromUniPay',
  getItems: '/getItems',
  getAuctions: '/getAuctions',
  searchAuctions: '/searchAuctions',
  getCategories: '/getCategories',
  createBidder: '/createBidder',
  getItemById: '/getItemById',
  getAuctionById: '/getAuctionById',
  getCategoryById: '/getCategoryById',
  getBreedById: '/getBreedById'
} as const;

/**
 * Get a category by id.
 */
router.get(p.getCategoryById, async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      id: Joi.string().required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { id } = req.query;
    const category = await categoryService.getById(id as string);
    return res.status(OK).json({ category });
  } catch (error) {
    throw error;
  }
});

/**
 * Get a breed by id.
 */
router.get(p.getBreedById, async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      id: Joi.string().required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { id } = req.query;
    const breed = await breedService.getById(id as string);
    return res.status(OK).json({ breed });
  } catch (error) {
    throw error;
  }
});

/**
 * Get an item by id.
 */
router.get(p.getItemById, async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      id: Joi.string().required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { id } = req.query;
    const item = await itemService.getById(id as string);
    return res.status(OK).json({ item });
  } catch (error) {
    throw error;
  }
});

/**
 * Get an auction by id.
 */
router.get(p.getAuctionById, async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      id: Joi.string().required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { id } = req.query;
    const auction = await auctionService.getById(id as string);
    return res.status(OK).json({ auction });
  } catch (error) {
    throw error;
  }
});

/**
 * Create the initial admin
 */
router.post(p.createInitAdmin, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      email: Joi.string().required().messages({
        'any.required': '"email" is a required field'
      }), // TODO: Validate email
      firstName: Joi.string().required().messages({
        'any.required': '"firstName" is a required field'
      }),
      lastName: Joi.string().required().messages({
        'any.required': '"lastName" is a required field'
      }),
      password: Joi.string().required().messages({
        'any.required': '"password" is a required field'
      }),
      tz: Joi.string().required().messages({
        'any.required': '"tz" is a required field'
      }),
      phone: phoneValidation.required().messages({
        'any.required': '"phone" is a required field'
      }),
      locale: Joi.string().required().messages({
        'any.required': '"locale" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const user = await userService.createInitAdmin(req.body);
    return res.status(CREATED).json({user});
  } catch (error) {
    throw error;
  }
});

/**
 * Create bidder
 */
router.post(p.createBidder, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      email: Joi.string().required().messages({
        'any.required': '"email" is a required field'
      }), // TODO: Validate email
      firstName: Joi.string().required().messages({
        'any.required': '"firstName" is a required field'
      }),
      lastName: Joi.string().required().messages({
        'any.required': '"lastName" is a required field'
      }),
      password: Joi.string().required().messages({
        'any.required': '"password" is a required field'
      }),
      tz: Joi.string().required().messages({
        'any.required': '"tz" is a required field'
      }),
      phone: phoneValidation.required().messages({
        'any.required': '"phone" is a required field'
      }),
      locale: Joi.string().required().messages({
        'any.required': '"locale" is a required field'
      }),
      identityNumber: Joi.string().required().messages({
        'any.required': '"identityNumber" is a required field'
      }),
      nationality: isoAlpha2CountryValidation.required().messages({
        'any.required': '"nationality" is a required field'
      }),
      dob: Joi.string().isoDate().required().messages({
        'any.required': '"dob" is a required field'
      }),
      gender: Joi.string().valid(EGenderType.FEMALE, EGenderType.MALE).required().messages({
        'any.required': '"gender" is a required field'
      }),
      physicalAddress: Joi.string().required().messages({
        'any.required': '"physicalAddress" is a required field'
      }),
      postalAddress: Joi.string().required().messages({
        'any.required': '"postalAddress" is a required field'
      }),
      keeperId: Joi.string().required().messages({
        'any.required': '"keeperId" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const user = await userService.createBidder(req.body);
    return res.status(CREATED).json({user});
  } catch (error) {
    throw error;
  }
});

/**
 * Process successful payment from tingg
 */
router.post(p.processSuccessfulPaymentFromTingg, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      accountNumber: Joi.string().required().messages({
        'any.required': '"accountNumber" is a required field'
      }),
      paymentMethod: Joi.string().required().messages({
        'any.required': '"paymentMethod" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const transaction = await transactionService.processSuccessfulPaymentFromTingg(req.body as any);
    return res.status(CREATED).json({transaction});
  } catch (error) {
    throw error;
  }
});

/**
 * Process successful payment from UniPay
 */
router.post(p.processSuccessfulPaymentFromUniPay, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      status: Joi.string().valid(EUniPayPaymentStatus.ACCEPTED).required().messages({
        'any.required': '"status" is a required field'
      }),
      payload: Joi.string().required().messages({
        'any.required': '"payload" is a required field'
      }),
      transaction: Joi.object().keys({
        id: mongoIdValidation.required().messages({
          'any.required': '"id" is a required field'
        }),
        currency: isoAlpha3CurrencyValidation.required().messages({
          'any.required': '"currency" is a required field'
        }),
        amount: Joi.number().required().messages({
          'any.required': '"amount" is a required field'
        })
      }).required()
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const transaction = await transactionService.processSuccessfulPaymentFromUniPay(req.body as any);
    return res.status(CREATED).json({transaction});
  } catch (error) {
    throw error;
  }
});

/**
 * Get categories.
 */
router.get(p.getCategories, async (req: Request, res: Response) => {
  try {
    const categories = await categoryService.getCategories();
    return res.status(OK).json({categories});
  } catch (error) {
    throw error;
  }
});

/**
 * Get auctions.
 */
router.get(p.getAuctions, async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EAuctionSortType.DATE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      categoryId: mongoIdValidation,
      status: Joi.string().valid(EAuctionStatus.ALL, EAuctionStatus.FRONT_VIEW, EAuctionStatus.NOT_BEGUN, EAuctionStatus.ACTIVE, EAuctionStatus.CANCELLED, EAuctionStatus.ENDED),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, categoryId, status } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (categoryId) {
      conditions.set('categoryId', categoryId);
    }

    if (status) {
      conditions.set('status', status);
    }

    const auctions = await auctionService.getAuctions(conditions);
    return res.status(OK).json({auctions});
  } catch (error) {
    throw error;
  }
});

/**
 * Search auctions
 */
router.post(p.searchAuctions, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      term: Joi.string().required().messages({
        'any.required': '"term" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const auctions = await auctionService.searchAuctions(req.body);
    return res.status(OK).json({auctions});
  } catch (error) {
    throw error;
  }
});

/**
 * Get items.
 */
router.get(p.getItems, async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EItemSortType.DATE, EItemSortType.RESERVE_PRICE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      categoryId: mongoIdValidation,
      auctionId: mongoIdValidation,
      status: Joi.string().valid(EItemStatus.NOT_BEGUN, EItemStatus.ACTIVE, EItemStatus.CANCELLED, EItemStatus.ENDED),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, categoryId, auctionId, status } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (categoryId) {
      conditions.set('categoryId', categoryId);
    }

    if (auctionId) {
      conditions.set('auctionId', auctionId);
    }

    if (status) {
      conditions.set('status', status);
    }

    const items = await itemService.getItems(conditions);
    return res.status(OK).json({items});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;