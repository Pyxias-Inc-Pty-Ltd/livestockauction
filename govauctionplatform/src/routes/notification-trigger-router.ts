import { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as Joi from 'joi';
import { EPushMessageReason, EPermission } from '../globals';
import { requirePermission } from '../shared/middleware';
import notificationTriggerService from '../services/notification-trigger-service';

// Constants
const router = Router();
const { CREATED, OK } = StatusCodes;

// Paths
export const p = {
  getNotificationTriggerByName: '/getNotificationTriggerByName',
  createNotificationTrigger: '/createNotificationTrigger',
  deleteNotificationTriggerById: '/deleteNotificationTriggerById'
} as const;

/**
 * Add one notification trigger.
 * 
 */
router.post(p.createNotificationTrigger, requirePermission(EPermission.NOTIFICATION_TRIGGER_MANAGE), async (req: Request, res: Response) => {
  try {
    const bSchema = Joi.object().keys({
      name: Joi.string().required().valid(EPushMessageReason.NOTIFY_USER_OF_FORUM_PARTICIPATION, EPushMessageReason.NOTIFY_USER_OF_STARTING_AUCTION, EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_PURCHASE_PAYMENT, EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_REFUND, EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_RESERVE_PRICE_PAYMENT, EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_REFUND, EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_RESERVE_PRICE_PAYMENT, EPushMessageReason.NOTIFY_USER_OF_UPCOMING_AUCTION).messages({
        'any.required': '"name" is a required field'
      }),
      description: Joi.string().required().messages({
        'any.required': '"description" is a required field'
      })
    }).required();
    
    // Validate schema against body
    Joi.assert(req.body, bSchema);

    const notificationTrigger = await notificationTriggerService.addOne(req.body);
    return res.status(CREATED).json({notificationTrigger});
  } catch (error) {
    throw error;
  }
});

/**
 * Get notification trigger by name.
 * 
 */
router.get(p.getNotificationTriggerByName, requirePermission(EPermission.NOTIFICATION_TRIGGER_MANAGE), async (req: Request, res: Response) => {
  try {

    // Query checks
    const qSchema = Joi.object().keys({
      name: Joi.string().required().messages({
        'any.required': '"name" is a required field'
      })
    }).required();

    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { name } = req.query;
    const notificationTrigger = await notificationTriggerService.getNotificationTriggerByName(name as string);
    return res.status(OK).json({notificationTrigger});
  } catch (error) {
    throw error;
  }
});

/**
 * Delete notification trigger.
 * 
 */
router.delete(p.deleteNotificationTriggerById, requirePermission(EPermission.NOTIFICATION_TRIGGER_MANAGE), async (req: Request, res: Response) => {
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
    await notificationTriggerService.delete(id as string);
    return res.status(OK).end();
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;