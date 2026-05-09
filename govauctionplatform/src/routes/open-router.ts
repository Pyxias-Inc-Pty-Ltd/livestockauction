import userService from '../services/user-service';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoAlpha2CountryValidation, isStringNumberLike, mongoIdValidation, phoneValidation } from '../shared/functions';
import transactionService from '../services/transaction-service';
import auctionService from '../services/auction-service';
import categoryService from '../services/category-service';
import itemService from '../services/item-service';
import collectionService from '../services/collection-service';
import { esService } from '../services/elasticsearch-service';
import { RequiredAttribute } from '../models/auction-model';
import {
  ESortOrderType,
  EAuctionSortType,
  EItemStatus,
  EItemSortType,
  EGenderType,
  EAuctionStatus,
  EPublishedStatus,
  ElasticsearchSortOption,
  ESectorType,
  EParticipationType,
  SearchFilters,
  ELanguageType,
  languageType
} from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createInitAdmin: '/createInitAdmin',
  processSuccessfulPaymentFromPayGate: '/processSuccessfulPaymentFromPayGate',
  getItems: '/getItems',
  getAuctions: '/getAuctions',
  search: '/search',
  getCategories: '/getCategories',
  createBidder: '/createBidder',
  getItemById: '/getItemById',
  getItemByTitleSlug: '/getItemByTitleSlug',
  getAuctionById: '/getAuctionById',
  getAuctionByTitleSlug: '/getAuctionByTitleSlug',
  getCategoryById: '/getCategoryById',
  getBreedById: '/getBreedById',
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
 * Get an item by titleSlug.
 */
router.get(p.getItemByTitleSlug, async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      titleSlug: Joi.string().required().messages({
        'any.required': '"titleSlug" is a required field'
      }),
      lang: Joi.string().required().valid(...Object.values(ELanguageType)).messages({
        'any.required': '"lang" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { titleSlug, lang } = req.query;
    const item = await itemService.getByTitleSlug(titleSlug as string, lang as languageType);
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

    let requiredAttributeSlugs: string[] = [];
    if (auction && auction.requiredAttributes?.length) {
      const attrs = await RequiredAttribute.find(
        { _id: { $in: auction.requiredAttributes } },
        { nameSlug: 1, _id: 0 }
      );
      requiredAttributeSlugs = attrs.map(a => a.nameSlug);
    }

    return res.status(OK).json({ auction: { ...auction?.toJSON(), requiredAttributeSlugs } });
  } catch (error) {
    throw error;
  }
});

/**
 * Get an auction by titleSlug.
 */
router.get(p.getAuctionByTitleSlug, async (req: Request, res: Response) => {
  try {
    // Query checks
    const qSchema = Joi.object().keys({
      titleSlug: Joi.string().required().messages({
        'any.required': '"titleSlug" is a required field'
      }),
      lang: Joi.string().required().valid(...Object.values(ELanguageType)).messages({
        'any.required': '"lang" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { titleSlug, lang } = req.query;
    const auction = await auctionService.getByTitleSlug(titleSlug as string, lang as languageType);
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
      populateCreator: Joi.boolean(),
      categoryId: mongoIdValidation,
      creatorId: mongoIdValidation,
      status: Joi.string().valid(EAuctionStatus.ALL, EAuctionStatus.FRONT_VIEW, EAuctionStatus.NOT_BEGUN, EAuctionStatus.ACTIVE, EAuctionStatus.CANCELLED, EAuctionStatus.ENDED),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      longitude: Joi.number().min(-180).max(180),
      latitude: Joi.number().min(-90).max(90),
      lastDocumentId: mongoIdValidation
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, categoryId, creatorId, status, populateCreator, longitude, latitude } = req.query;

    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (populateCreator) {
      conditions.set('populateCreator', populateCreator as string === "true");
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

    if (typeof longitude === 'string' && typeof latitude === 'string') {
      const coords: Array<number> = [];
      coords.push(parseFloat(longitude));
      coords.push(parseFloat(latitude));
      conditions.set('auctionCoordinates', coords);
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
router.get(p.search, async (req: Request, res: Response) => {
  try {
    // Define validation schema for query parameters
    const qSchema = Joi.object().keys({
      // Text search
      searchTerm: Joi.string().trim(),
      language: Joi.string().valid(...Object.values(ELanguageType))
      .messages({
        'any.required': '"language" is a required field'
      }),
      // Pagination
      from: Joi.number().min(0).default(0).required()
      .messages({
        'any.required': '"from" is a required field'
      }),
      size: Joi.number().min(1).max(100).default(20).required()
      .messages({
        'any.required': '"size" is a required field'
      }),

      // Sorting
      sortOption: Joi.string()
        .valid(...Object.values(ElasticsearchSortOption))
        .required()
        .messages({
          'any.required': '"sortOption" is a required field'
        }),

      // Location (required for CLOSEST_TO_ME sort)
      lat: Joi.number().when('sortOption', {
        is: ElasticsearchSortOption.CLOSEST_TO_ME,
        then: Joi.number().min(-90).max(90).required().messages({
          'any.required': '"lat" is required for distance-based sorting'
        }),
        otherwise: Joi.optional()
      }),
      lon: Joi.number().when('sortOption', {
        is: ElasticsearchSortOption.CLOSEST_TO_ME,
        then: Joi.number().min(-180).max(180).required().messages({
          'any.required': '"lon" is required for distance-based sorting'
        }),
        otherwise: Joi.optional()
      }),
      distance: Joi.string().pattern(/^\d+(km|mi)$/),

      // Filters
      sectorType: Joi.alternatives().try(
        Joi.array().items(Joi.string().valid(...Object.values(ESectorType))),
        Joi.string().valid(...Object.values(ESectorType))
      ),
      hasRegistrationFee: Joi.boolean(),
      participationType: Joi.alternatives().try(
        Joi.array().items(Joi.string().valid(...Object.values(EParticipationType))),
        Joi.string().valid(...Object.values(EParticipationType))
      ),
      startTime: Joi.string().isoDate(),
      endTime: Joi.string().isoDate(),
      lotStatus: Joi.alternatives().try(
        Joi.array().items(Joi.string().valid(...Object.values(EItemStatus))),
        Joi.string().valid(...Object.values(EItemStatus))
      ),
      isBeingLivestreamed: Joi.boolean()
    }).required();

    // Validate query parameters
    Joi.assert(req.query, qSchema);

    const {
      searchTerm,
      language,
      from,
      size,
      sortOption,
      lat,
      lon,
      distance,
      sectorType,
      hasRegistrationFee,
      participationType,
      startTime,
      endTime,
      lotStatus,
      isBeingLivestreamed
    } = req.query;

    // Prepare filters object
    const filters = {
      searchTerm: searchTerm as string,
      from: Number(from),
      size: Number(size),
      distance: distance ? {
        lat: Number(lat),
        lon: Number(lon),
        distance: distance as string
      } : undefined,
      sectorType: sectorType ? (Array.isArray(sectorType) ? sectorType : [sectorType]) : undefined,
      hasRegistrationFee: hasRegistrationFee ? Boolean(hasRegistrationFee) : undefined,
      participationType: participationType ? (Array.isArray(participationType) ? participationType : [participationType]) : undefined,
      timeRange: (startTime || endTime) ? {
        startTime: startTime ? new Date(startTime as string) : undefined,
        endTime: endTime ? new Date(endTime as string) : undefined
      } : undefined,
      lotStatus: lotStatus ? (Array.isArray(lotStatus) ? lotStatus : [lotStatus]) : undefined,
      isBeingLivestreamed: isBeingLivestreamed ? Boolean(isBeingLivestreamed) : undefined
    } as SearchFilters;

    // Prepare location for distance-based sorting
    const location = lat && lon ? {
      lat: Number(lat),
      lon: Number(lon)
    } : undefined;

    // Perform search
    const results = await esService.search(
      filters,
      sortOption as ElasticsearchSortOption,
      location,
      language as any
    );

    return res.status(OK).json(results);
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