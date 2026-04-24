import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { requirePermission } from '../shared/middleware';
import { IAdmin, IBidder } from '../models/user-model';
import messageService from '../services/message-service';
import { EMessageSortType, EPermission, ESortOrderType } from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  createMessage: '/createMessage',
  getMessages: '/getMessages'
} as const;

/**
 * Create a message
 */
router.post(p.createMessage, requirePermission(EPermission.MESSAGE_WRITE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      adminId: mongoIdValidation.required().messages({
        'any.required': '"adminId" is required'
      }),
      bidderId: mongoIdValidation.required().messages({
        'any.required': '"bidderId" is required'
      }),
      content: Joi.string().required().messages({
        'any.required': '"content" is required'
      })
    })
    .required();

    // Validate schema against input
    Joi.assert(req.body, schema);

    const message = await messageService.createMessage(req.user as IBidder | IAdmin, req.body as any);
    return res.status(CREATED).json({message});
  } catch (error) {
    throw error;
  }
});

/**
 * Get messages.
 */
router.get(p.getMessages, requirePermission(EPermission.MESSAGE_READ), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EMessageSortType.DATE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      adminId: mongoIdValidation.required().messages({
        'any.required': '"adminId" is a required field'
      }),
      bidderId: mongoIdValidation.required().messages({
        'any.required': '"bidderId" is a required field'
      }),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, adminId, bidderId } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);
    conditions.set('adminId', adminId);
    conditions.set('bidderId', bidderId);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    const messages = await messageService.getMessages(conditions);
    return res.status(OK).json({messages});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;