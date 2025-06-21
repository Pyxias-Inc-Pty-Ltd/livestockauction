import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { BidderOnly, SellerOnly, SuperAdminOnly } from '../shared/middleware';
import {ENotificationSortType, ESortOrderType} from '../globals';
import notificationService from '../services/notification-service';
import { IUser } from '../models/user-model';

// Constants
const router = Router();
const { OK } = StatusCodes;

// Paths
export const p = {
  getOwnNotifications: '/getOwnNotifications'
} as const;

/**
 * Get own notifications.
 */
router.get(p.getOwnNotifications, SellerOnly(), BidderOnly(), SuperAdminOnly(), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(ENotificationSortType.DATE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, chatId } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    const notifications = await notificationService.getOwnNotifications(req.user as IUser, conditions);
    return res.status(OK).json({notifications});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;