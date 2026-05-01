import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isoDateValidation, isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { requirePermission } from '../shared/middleware';
import { IAdmin, IAuctionApprover, ISeller, IUser } from '../models/user-model';
import auctionService from '../services/auction-service';
import { EAuctionStatus, EAuctionSortType, EParticipationType, EPermission, ESortOrderType, EPublishedStatus } from '../globals';

// Constants
const router = Router();
const { OK, CREATED, NOT_FOUND } = StatusCodes;

// Paths
export const p = {
  createAuction: '/createAuction',
  createRequiredAttribute: '/createRequiredAttribute',
  deleteAuction: '/deleteAuction',
  getAuctionReport: '/getAuctionReport',
  getRequiredAttributes: '/getRequiredAttributes',
  publishAuction: '/publishAuction',
  unpublishAuction: '/unpublishAuction',
  rejectAuction: '/rejectAuction',
  getAllAuctions: '/getAllAuctions',
  updateAuctionCoordinates: '/updateAuctionCoordinates',
  addInvitedBidders: '/addInvitedBidders',
  removeInvitedBidder: '/removeInvitedBidder',
  getInvitedBidders: '/getInvitedBidders',
} as const;

/**
 * Create an auction
 */
router.post(p.createAuction, requirePermission(EPermission.AUCTION_CREATE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
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
      auctionLocation: Joi.string().required().messages({
        'any.required': '"auctionLocation" is a required field'
      }),
      auctionCoordinates: Joi.object().keys({
        coordinates: Joi.array().items(Joi.number().min(-180).max(180)).length(2).required().messages({
          'any.required': '"auctionCoordinates.coordinates" is a required field'
        }),
      }).required().messages({
        'any.required': '"auctionCoordinates" is a required field'
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
      isBeingLivestreamed: Joi.boolean().required().messages({
        'any.required': '"isBeingLivestreamed" is a required field'
      }),
      streamUrl: Joi.string().uri().when('isBeingLivestreamed', {
        is: true,
        then: Joi.required().messages({
          'any.required': '"streamUrl" is a required field'
        }),
        otherwise: Joi.optional()
      }),
      thumbnailUrl: Joi.required().messages({
        'any.required': '"thumbnailUrl" is a required field'
      }),
      hasRegistrationFee: Joi.boolean().required().messages({
        'any.required': '"hasRegistrationFee" is a required field'
      }),
      registrationFee: Joi.number().min(0).when('hasRegistrationFee', {
        is: true,
        then: Joi.required().messages({
          'any.required': '"registrationFee" is a required field'
        }),
        otherwise: Joi.optional()
      }),
      categoryId: mongoIdValidation.required().messages({
        'any.required': '"categoryId" is a required field'
      }),
      startTime: isoDateValidation.required().messages({
        'any.required': '"startTime" is a required field'
      }),
      endTime: isoDateValidation.required().messages({
        'any.required': '"endTime" is a required field'
      }),
      participationType: Joi.string().valid(
        EParticipationType.CITIZEN_ONLY,
        EParticipationType.EVERYONE
      ).required().messages({
        'any.required': '"participationType" is a required field'
      }),
      requiredAttributes: Joi.array().items(mongoIdValidation).messages({
        'array.base': '"requiredAttributes" should be an array of valid MongoDB IDs'
      }).required().default([]).messages({
        'any.required': '"requiredAttributes" is a required field'
      }),
      collectionWindowDays: Joi.number().integer().min(1).required().messages({
        'any.required': '"collectionWindowDays" is a required field'
      }),
      collectionStartTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required().messages({
        'any.required': '"collectionStartTime" is a required field',
        'string.pattern.base': '"collectionStartTime" must be in HH:mm format'
      }),
      collectionEndTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required().messages({
        'any.required': '"collectionEndTime" is a required field',
        'string.pattern.base': '"collectionEndTime" must be in HH:mm format'
      }),
      isInviteOnly: Joi.boolean().default(false),
      invitedBidders: Joi.array().items(mongoIdValidation).default([]),
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
 * Create a required attribute
 */
router.post(p.createRequiredAttribute, requirePermission(EPermission.AUCTION_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      name: Joi.string().required().messages({
        'any.required': '"name" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const requiredAttribute = await auctionService.createRequiredAttribute(req.user as IAdmin, req.body as any);
    return res.status(CREATED).json({requiredAttribute});
  } catch (error) {
    throw error;
  }
});

/**
 * Delete an auction
 */
router.delete(p.deleteAuction, requirePermission(EPermission.AUCTION_DELETE), async (req: Request, res: Response) => {
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

/**
 * Get auction report
 */
router.get(p.getAuctionReport, requirePermission(EPermission.AUCTION_REPORT), async (req: Request, res: Response) => {
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

    const report = await auctionService.getAuctionReport(auctionId as string);

    return res.status(OK).json({ report });
  } catch (error) {
    throw error;
  }
});

/**
 * Get a list of required attributes
 */
router.get(p.getRequiredAttributes, requirePermission(EPermission.AUCTION_MANAGE), async (req: Request, res: Response) => {
  try {
    const requiredAttributes = await auctionService.getRequiredAttributes();
    return res.status(OK).json({ requiredAttributes });
  } catch (error) {
    throw error;
  }
});

/**
 * Publish an auction by an auction approver
 */
router.put(p.publishAuction, requirePermission(EPermission.AUCTION_APPROVE), async (req: Request, res: Response) => {
  try {
    // Query validation
    const schema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field'
      })
    }).required();
    
    Joi.assert(req.body, schema);

    const { auctionId } = req.body;

    const auction = await auctionService.publishAuction(
      req.user as IAuctionApprover, 
      auctionId as string
    );

    return res.status(OK).json({ auction });
  } catch (error) {
    throw error;
  }
});

/**
 * Unpublish an auction by a seller
 */
router.put(p.unpublishAuction, requirePermission(EPermission.AUCTION_UNPUBLISH), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field'
      })
    }).required();
    
    Joi.assert(req.body, schema);

    const { auctionId } = req.body;

    const auction = await auctionService.unpublishAuction(
      req.user as ISeller,
      auctionId as string
    );

    return res.status(OK).json({ auction });
  } catch (error) {
    throw error;
  }
});

/**
 * Reject an auction
 */
router.put(p.rejectAuction, requirePermission(EPermission.AUCTION_REJECT), async (req: Request, res: Response) => {
  try {
    // Body validation
    const schema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field'
      }),
      reason: Joi.string().required().messages({
        'any.required': '"reason" is required for rejection'
      })
    }).required();
    
    Joi.assert(req.body, schema);

    const { auctionId, reason } = req.body;

    const auction = await auctionService.rejectAuction(
      req.user as IAuctionApprover,
      auctionId as string,
      reason
    );

    return res.status(OK).json({ auction });
  } catch (error) {
    throw error;
  }
});

/**
 * Get all auctions (protected route - for backend admins only).
 */
router.get(p.getAllAuctions, requirePermission(EPermission.AUCTION_READ), async (req: Request, res: Response) => {
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
      status: Joi.string().valid(EAuctionStatus.ALL, EAuctionStatus.NOT_BEGUN, EAuctionStatus.ACTIVE, EAuctionStatus.CANCELLED, EAuctionStatus.ENDED),
      publishedStatus: Joi.string().valid(EPublishedStatus.PUBLISHED, EPublishedStatus.REJECTED, EPublishedStatus.UNPUBLISHED),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, categoryId, creatorId, status, publishedStatus } = req.query;

    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if ((req.user as IAuctionApprover).createdBySeller) {
      conditions.set('creatorId', (req.user as IAuctionApprover).createdBySeller.toString());
    } else if ((req.user as IUser).userType === 'SELLER') {
      conditions.set('creatorId', (req.user as IUser)._id.toString());
    } else if (creatorId) {
      conditions.set('creatorId', creatorId);
    }

    if (categoryId) {
      conditions.set('categoryId', categoryId);
    }

    if (publishedStatus) {
      conditions.set('publishedStatus', publishedStatus);
    }

    if (status) {
      conditions.set('status', status);
    }

    const auctions = await auctionService.getAuctions(conditions);
    return res.status(OK).json({ auctions });
  } catch (error) {
    throw error;
  }
});

/**
 * Update auction coordinates
 */
router.put(p.updateAuctionCoordinates, requirePermission(EPermission.AUCTION_UPDATE),
  async (req: Request, res: Response) => {
      try {
        const schema = Joi.object().keys({
          auctionId: mongoIdValidation.required().messages({
            'any.required': '"auctionId" is a required field'
          }),
          auctionCoordinates: Joi.array()
            .items(Joi.number().min(-180).max(180))
            .length(2)
            .required()
            .messages({
              'array.base': '"auctionCoordinates" should be an array of [longitude, latitude]',
              'array.length': '"auctionCoordinates" must contain exactly 2 numbers [longitude, latitude]',
              'any.required': '"auctionCoordinates" is a required field'
            })
        });

        // Validate request body
        Joi.assert(req.body, schema);

        const { auctionId, auctionCoordinates } = req.body;

        // Update auction in the database
        const updatedAuction = await auctionService.updateAuctionCoordinates(
          auctionId,
          { type: 'Point', coordinates: auctionCoordinates }
        );

        if (!updatedAuction) {
          return res.status(NOT_FOUND).json({ message: 'Auction not found' });
        }

        return res.status(OK).json({ auction: updatedAuction });
      } catch (error) {
        throw error;
      }
    }
  );

/**
 * Add invited bidders to an auction.
 */
router.post(p.addInvitedBidders, requirePermission(EPermission.AUCTION_CREATE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field',
      }),
      bidderIds: Joi.array().items(mongoIdValidation).min(1).required().messages({
        'any.required': '"bidderIds" is a required field',
      }),
    }).required();

    Joi.assert(req.body, schema);

    const { auctionId, bidderIds } = req.body;
    const auction = await auctionService.addInvitedBidders(auctionId, bidderIds);
    return res.status(OK).json({ auction });
  } catch (error) {
    throw error;
  }
});

/**
 * Remove an invited bidder from an auction.
 */
router.post(p.removeInvitedBidder, requirePermission(EPermission.AUCTION_CREATE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field',
      }),
      bidderId: mongoIdValidation.required().messages({
        'any.required': '"bidderId" is a required field',
      }),
    }).required();

    Joi.assert(req.body, schema);

    const { auctionId, bidderId } = req.body;
    const auction = await auctionService.removeInvitedBidder(auctionId, bidderId);
    return res.status(OK).json({ auction });
  } catch (error) {
    throw error;
  }
});

/**
 * Get invited bidders for an auction with full details.
 */
router.get(p.getInvitedBidders, async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      auctionId: mongoIdValidation.required().messages({
        'any.required': '"auctionId" is a required field',
      }),
    }).required();

    Joi.assert(req.query, qSchema);

    const { auctionId } = req.query;
    const bidders = await auctionService.getInvitedBidders(auctionId as string);
    return res.status(OK).json({ bidders });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;