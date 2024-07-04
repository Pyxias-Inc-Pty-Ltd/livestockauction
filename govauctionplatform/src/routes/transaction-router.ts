import { IBidder } from '../models/user-model';
import transactionService from '../services/transaction-service';
import { BidderOnly } from '../shared/middleware';
import * as Joi from 'joi';
import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import { isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { EPaymentProvider, EPaymentStatus, ESortOrderType, ETransactionSortType, ETransactionType } from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  initiateItemReservation: '/initiateItemReservation',
  initiatePurchaseItemByWinningBidder: '/initiatePurchaseItemByWinningBidder',
  initiatePurchaseItemUsingBuyoutPrice: '/initiatePurchaseItemUsingBuyoutPrice',
  getTransactions: '/getTransactions'
} as const;

/**
 * Initiate item reservation
 */
router.post(p.initiateItemReservation, BidderOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      paymentProvider: Joi.string().valid(EPaymentProvider.CELLULANT, EPaymentProvider.UNIPAY).required().messages({
        'any.required': '"paymentProvider" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const transaction = await transactionService.initiateItemReservation(req.user as IBidder, req.body as any);
    return res.status(CREATED).json({transaction});
  } catch (error) {
    throw error;
  }
});

/**
 * Purchase item by winning bidder
 */
router.post(p.initiatePurchaseItemByWinningBidder, BidderOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      paymentProvider: Joi.string().valid(EPaymentProvider.CELLULANT, EPaymentProvider.UNIPAY).required().messages({
        'any.required': '"paymentProvider" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const transaction = await transactionService.initiatePurchaseItemByWinningBidder(req.user as IBidder, req.body as any);
    return res.status(CREATED).json({transaction});
  } catch (error) {
    throw error;
  }
});

/**
 * Purchase item using buyout price
 */
router.post(p.initiatePurchaseItemUsingBuyoutPrice, BidderOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      itemId: mongoIdValidation.required().messages({
        'any.required': '"itemId" is a required field'
      }),
      paymentProvider: Joi.string().valid(EPaymentProvider.CELLULANT, EPaymentProvider.UNIPAY).required().messages({
        'any.required': '"paymentProvider" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const transaction = await transactionService.initiatePurchaseItemUsingBuyoutPrice(req.user as IBidder, req.body as any);
    return res.status(CREATED).json({transaction});
  } catch (error) {
    throw error;
  }
});

/**
 * Get transactions.
 */
router.get(p.getTransactions, BidderOnly(), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(ETransactionSortType.DATE, ETransactionSortType.AMOUNT).messages({
        'any.required': '"sortBy" is a required field'
      }),
      itemId: mongoIdValidation,
      buyerId: mongoIdValidation,
      sellerId: mongoIdValidation,
      transactionType: Joi.string().valid(ETransactionType.PURCHASE, ETransactionType.REFUND, ETransactionType.RESERVATION),
      status: Joi.string().valid(EPaymentStatus.COMPLETED, EPaymentStatus.FAILED, EPaymentStatus.PENDING),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, itemId, buyerId, sellerId, transactionType, status } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (itemId) {
      conditions.set('itemId', itemId);
    }

    if (buyerId) {
      conditions.set('buyerId', buyerId);
    }

    if (sellerId) {
      conditions.set('sellerId', sellerId);
    }

    if (transactionType) {
      conditions.set('transactionType', transactionType);
    }

    if (status) {
      conditions.set('status', status);
    }

    const transactions = await transactionService.getTransactions(conditions);
    return res.status(OK).json({transactions});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;