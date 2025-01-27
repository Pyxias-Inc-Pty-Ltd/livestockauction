import userService from '../services/user-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoAlpha2CountryValidation, isoAlpha3CurrencyValidation, isStringNumberLike, mongoIdValidation, phoneValidation } from '../shared/functions';
import transactionService from '../services/transaction-service';
import auctionService from '../services/auction-service';
import categoryService from '../services/category-service';
import itemService from '../services/item-service';
import {
  ESortOrderType,
  EAuctionSortType,
  EItemStatus,
  EItemSortType,
  EUniPayPaymentStatus,
  EGenderType,
  EAuctionStatus,
  EPublishedStatus
} from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createInitAdmin: '/createInitAdmin',
  processSuccessfulPaymentFromTingg: '/processSuccessfulPaymentFromTingg',
  processSuccessfulPaymentFromUniPay: '/processSuccessfulPaymentFromUniPay',
  processSuccessfulPaymentFromPayGate: '/processSuccessfulPaymentFromPayGate',
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
      isOrganization: Joi.boolean().required().messages({
        'any.required': '"isOrganization" is a required field'
      }),
      identityNumber: Joi.string().required().messages({
        'any.required': '"identityNumber" is a required field'
      }),
      nationality: Joi.when('isOrganization', {
        is: false,
        then: isoAlpha2CountryValidation.required().messages({
          'any.required': '"nationality" is a required field'
        }),
        otherwise: isoAlpha2CountryValidation
      }),
      dob: Joi.when('isOrganization', {
        is: false,
        then: Joi.date().required().messages({
          'any.required': '"dob" is a required field'
        }),
        otherwise: Joi.date()
      }),
      gender: Joi.when('isOrganization', {
        is: false,
        then: Joi.string().valid(EGenderType.FEMALE, EGenderType.MALE).required().messages({
          'any.required': '"gender" is a required field'
        }),
        otherwise: Joi.string().valid(EGenderType.FEMALE, EGenderType.MALE)
      }),
      physicalAddress: Joi.string().required().messages({
        'any.required': '"physicalAddress" is a required field'
      }),
      postalAddress: Joi.string().required().messages({
        'any.required': '"postalAddress" is a required field'
      }),
      email: Joi.when('isOrganization', {
        is: true,
        then: Joi.string().required().messages({
          'any.required': '"email" is a required field'
        }),
        otherwise: Joi.string()
      }),
      phone: phoneValidation.required().messages({
        'any.required': '"phone" is a required field'
      }),
      password: Joi.string().required().messages({
        'any.required': '"password" is a required field'
      }),
      firstName: Joi.when('isOrganization', {
        is: false,
        then: Joi.string().required().messages({
          'any.required': '"firstName" is a required field'
        }),
        otherwise: Joi.string()
      }),
      lastName: Joi.when('isOrganization', {
        is: false,
        then: Joi.string().required().messages({
          'any.required': '"lastName" is a required field'
        }),
        otherwise: Joi.string()
      }),
      name: Joi.when('isOrganization', {
        is: true,
        then: Joi.string().required().messages({
          'any.required': '"name" is a required field'
        }),
        otherwise: Joi.string()
      }),
      locale: Joi.string().required().messages({
        'any.required': '"locale" is a required field'
      }),
      tz: Joi.string().required().messages({
        'any.required': '"tz" is a required field'
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
      amount: Joi.number().required().messages({
        'any.required': '"amount" is a required field'
      }),
      serviceCode: Joi.string().required().messages({
        'any.required': '"serviceCode" is a required field'
      }),
      checkoutRequestID: Joi.number().required().messages({
        'any.required': '"checkoutRequestID" is a required field'
      }),
      accountNumber: Joi.string().required().messages({
        'any.required': '"accountNumber" is a required field'
      }),
      customerName: Joi.string().required().messages({
        'any.required': '"customerName" is a required field'
      }),
      billingServiceID: Joi.number().required().messages({
        'any.required': '"billingServiceID" is a required field'
      }),
      payerTransactionIDs: Joi.array().items(Joi.string()).required().messages({
        'any.required': '"payerTransactionIDs" is a required field'
      }),
      paybylinkTransactionID: Joi.string().required().messages({
        'any.required': '"paybylinkTransactionID" is a required field'
      }),
      billID: Joi.number().required().messages({
        'any.required': '"billID" is a required field'
      }),
      paymentMethod: Joi.string().required().messages({
        'any.required': '"paymentMethod" is a required field'
      }),
      currency: Joi.string().required().messages({
        'any.required': '"currency" is a required field'
      }),
      msisdn: Joi.string().required().messages({
        'any.required': '"msisdn" is a required field'
      }),
      paymentDate: Joi.number().required().messages({
        'any.required': '"paymentDate" is a required field'
      }),
      paymentStatus: Joi.number().required().messages({
        'any.required': '"paymentStatus" is a required field'
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
 * Process successful payment from PayGate
 */
router.post(p.processSuccessfulPaymentFromPayGate, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      PAYGATE_ID: Joi.string().required().messages({
        'any.required': '"PAYGATE_ID" is a required field',
      }),
      PAY_REQUEST_ID: Joi.string().required().messages({
        'any.required': '"PAY_REQUEST_ID" is a required field',
      }),
      REFERENCE: Joi.string().required().messages({
        'any.required': '"REFERENCE" is a required field',
      }),
      TRANSACTION_STATUS: Joi.string().valid("1", "0").required().messages({
        'any.required': '"TRANSACTION_STATUS" is a required field',
      }),
      RESULT_CODE: Joi.string().required().messages({
        'any.required': '"RESULT_CODE" is a required field',
      }),
      AUTH_CODE: Joi.string().optional(),
      CURRENCY: Joi.string().required().messages({
        'any.required': '"CURRENCY" is a required field',
      }),
      AMOUNT: Joi.number().required().messages({
        'any.required': '"AMOUNT" is a required field',
      }),
      RESULT_DESC: Joi.string().optional(),
      TRANSACTION_ID: Joi.string().required().messages({
        'any.required': '"TRANSACTION_ID" is a required field',
      }),
      RISK_INDICATOR: Joi.string().optional(),
      PAY_METHOD: Joi.string().optional(),
      PAY_METHOD_DETAIL: Joi.string().optional(),
      CHECKSUM: Joi.string().required().messages({
        'any.required': '"CHECKSUM" is a required field',
      }),
    });

    // Validate schema against input
    Joi.assert(req.body, schema);

    // Log or process the received payment details
    const paymentDetails = req.body;
    console.log('Payment details:', paymentDetails);

    // Call your service to handle the successful payment
    const transaction = await transactionService.processSuccessfulPaymentFromPayGate(paymentDetails);

    return res.status(CREATED).json({ transaction });
  } catch (error) {
    console.error('Error processing PayGate payment:', error);
    return res.status(400).json({ error: error.message });
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
 * Get auctions (public route - only published auctions).
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
      creatorId: mongoIdValidation,
      status: Joi.string().valid(EAuctionStatus.ALL, EAuctionStatus.FRONT_VIEW, EAuctionStatus.NOT_BEGUN, EAuctionStatus.ACTIVE, EAuctionStatus.CANCELLED, EAuctionStatus.ENDED),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, categoryId, creatorId, status } = req.query;

    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (creatorId) {
      conditions.set('creatorId', creatorId);
    }

    if (categoryId) {
      conditions.set('categoryId', categoryId);
    }

    if (status) {
      conditions.set('status', status);
    }

    // Ensures only published auctions are returned
    conditions.set('publishedStatus', EPublishedStatus.PUBLISHED);

    const auctions = await auctionService.getAuctions(conditions);
    return res.status(OK).json({ auctions });
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