import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { mongoIdValidation, isStringNumberLike } from '../shared/functions';
import { requirePermission, requireAnyPermission } from '../shared/middleware';
import { IAdmin, IBidder, IUser } from '../models/user-model';
import collectionService from '../services/collection-service';
import transactionService from '../services/transaction-service';
import { ECollectionStatus, EPermission, ESortOrderType } from '../globals';

// Constants
const router = Router();
const { OK } = StatusCodes;

// Paths
export const p = {
  validateCollectionCode: '/validateCollectionCode',
  raiseDispute: '/raiseDispute',
  resolveDispute: '/resolveDispute',
  getCollections: '/getCollections',
  getByItemId: '/getByItemId',
  initiateDisputeRefund: '/initiateDisputeRefund',
  getMyCollection: '/getMyCollection',
  resendCollectionOtp: '/resendCollectionOtp'
} as const;

/**
 * Validate a buyer's collection OTP code.
 * Accessible by sellers and admins.
 */
router.post(p.validateCollectionCode, requirePermission(EPermission.COLLECTION_VALIDATE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      otpCode: Joi.string().length(8).pattern(/^\d+$/).required().messages({
        'any.required': '"otpCode" is a required field',
        'string.length': '"otpCode" must be exactly 8 digits',
        'string.pattern.base': '"otpCode" must be numeric'
      })
    }).required();

    Joi.assert(req.body, schema);

    const collection = await collectionService.validateCollectionCode(
      req.user as IUser,
      req.body as any
    );

    return res.status(OK).json({ collection });
  } catch (error) {
    throw error;
  }
});

/**
 * Raise a dispute on a collection.
 * Accessible by sellers and admins.
 */
router.post(p.raiseDispute, requirePermission(EPermission.COLLECTION_DISPUTE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      collectionId: mongoIdValidation.required().messages({
        'any.required': '"collectionId" is a required field'
      }),
      reason: Joi.string().min(10).required().messages({
        'any.required': '"reason" is a required field',
        'string.min': '"reason" must be at least 10 characters'
      })
    }).required();

    Joi.assert(req.body, schema);

    const collection = await collectionService.raiseDispute(req.user as IUser, req.body as any);

    return res.status(OK).json({ collection });
  } catch (error) {
    throw error;
  }
});

/**
 * Resolve a disputed collection (super admin only).
 * Optionally links a refund transaction that was previously initiated.
 */
router.put(p.resolveDispute, requirePermission(EPermission.COLLECTION_RESOLVE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      collectionId: mongoIdValidation.required().messages({
        'any.required': '"collectionId" is a required field'
      }),
      refundTransactionId: mongoIdValidation
    }).required();

    Joi.assert(req.body, schema);

    const collection = await collectionService.resolveDispute(
      req.user as IAdmin,
      req.body as any
    );

    return res.status(OK).json({ collection });
  } catch (error) {
    throw error;
  }
});

/**
 * Initiate a PayGate refund for a disputed collection (super admin only).
 * Creates a REFUND transaction linked to the original PURCHASE transaction.
 */
router.post(p.initiateDisputeRefund, requirePermission(EPermission.COLLECTION_REFUND), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      collectionId: mongoIdValidation.required().messages({
        'any.required': '"collectionId" is a required field'
      })
    }).required();

    Joi.assert(req.body, schema);

    const collection = await collectionService.getById(req.body.collectionId);

    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (collection.status !== ECollectionStatus.DISPUTED) {
      return res.status(400).json({ message: `Collection must be in DISPUTED status` });
    }

    const refundTransaction = await transactionService.initiateDisputeRefund(
      collection.purchaseTransactionId.toString()
    );

    return res.status(OK).json({ refundTransaction });
  } catch (error) {
    throw error;
  }
});

/**
 * Get a collection record by item ID.
 * Accessible by sellers and admins.
 */
router.get(p.getByItemId, requirePermission(EPermission.COLLECTION_READ), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      })
    }).required();

    Joi.assert(req.query, qSchema);

    const { itemId } = req.query;
    const collection = await collectionService.getByItemId(itemId as string);

    return res.status(OK).json({ collection });
  } catch (error) {
    throw error;
  }
});

/**
 * List collections with filters.
 * Accessible by sellers, admins, and bidders (own collections only).
 */
router.get(p.getCollections, requireAnyPermission(EPermission.COLLECTION_READ, EPermission.COLLECTION_READ_OWN), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(
        ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc
      ).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      itemId: mongoIdValidation,
      buyerId: mongoIdValidation,
      sellerId: mongoIdValidation,
      auctionId: mongoIdValidation,
      status: Joi.string().valid(
        ECollectionStatus.AWAITING_COLLECTION,
        ECollectionStatus.COLLECTED,
        ECollectionStatus.DISPUTED,
        ECollectionStatus.FORFEITED,
        ECollectionStatus.RESOLVED
      ),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();

    Joi.assert(req.query, qSchema);

    const { limit, sortOrder, lastDocumentId, itemId, buyerId, sellerId, auctionId, status } = req.query;

    // Bidders with only COLLECTION_READ_OWN are restricted to their own collections
    const isScopedToOwn = !req.permissions.includes(EPermission.COLLECTION_READ)
      && req.permissions.includes(EPermission.COLLECTION_READ_OWN);

    const conditions = new Map<string, any>();
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) conditions.set('lastDocumentId', lastDocumentId);
    if (itemId) conditions.set('itemId', itemId);

    if (isScopedToOwn) {
      // Force buyerId to the authenticated user's own ID
      conditions.set('buyerId', (req.user as IUser)._id);
    } else if (buyerId) {
      conditions.set('buyerId', buyerId);
    }

    if (sellerId) conditions.set('sellerId', sellerId);
    if (auctionId) conditions.set('auctionId', auctionId);
    if (status) conditions.set('status', status);

    const collections = await collectionService.getCollections(conditions);

    return res.status(OK).json({ collections });
  } catch (error) {
    throw error;
  }
});

/**
 * Get the buyer's own collection for an item (bidder only).
 * Returns the collection record without the OTP hash.
 */
router.get(p.getMyCollection, requirePermission(EPermission.COLLECTION_READ_OWN), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      })
    }).required();

    Joi.assert(req.query, qSchema);

    const { itemId } = req.query;
    const collection = await collectionService.getMyCollection(
      req.user as IBidder,
      itemId as string
    );

    return res.status(OK).json({ collection });
  } catch (error) {
    throw error;
  }
});

/**
 * Resend the collection OTP to the buyer (bidder only).
 * Generates a fresh code, updates the stored hash, and re-sends email + push.
 */
router.post(p.resendCollectionOtp, requirePermission(EPermission.COLLECTION_OTP_RESEND), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      })
    }).required();

    Joi.assert(req.body, schema);

    await collectionService.resendCollectionOtp(req.user as IBidder, req.body.itemId);

    return res.status(OK).json({ message: 'Collection code resent successfully' });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;
