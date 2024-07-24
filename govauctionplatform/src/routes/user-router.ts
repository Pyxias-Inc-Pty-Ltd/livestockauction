import { SuperAdminOnly } from '../shared/middleware';
import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import { isStringNumberLike, mongoIdValidation, phoneValidation } from '../shared/functions';
import userService from '../services/user-service';
import { IAdmin, IUser } from '../models/user-model';
import { InternalServerError } from '../shared/errors';
import { ESortOrderType, EUserSortType, EUserType } from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  getUsers: '/getUsers',
  getBidders: '/getBidders',
  getAdmins: '/getAdmins',
  getOwnAccount: '/getOwnAccount',
  updatePassword: '/updatePassword',
  createAdmin: '/createAdmin',
  createSeller: '/createSeller',
  getAdminById: '/getAdminById',
  getBidderById: '/getBidderById',
  deleteAdminById: '/deleteAdminById',
  deleteBidderById: '/deleteBidderById',
  setFirebaseTokenId: '/setFirebaseTokenId'
} as const;

/**
 * Get own account.
 */
router.get(p.getOwnAccount, async (req: Request, res: Response) => {
  try {
    if (req.user && (req.user as any)._id) {
      const user = await userService.getById((req.user as any)._id);
      return res.status(OK).json({user});
    } else {
      throw new InternalServerError('User object not found on request: Debug auth');
    }
  } catch (error) {
    throw error;
  }
});

/**
 * Create seller
 */
router.post(p.createSeller, SuperAdminOnly(), async (req: Request, res: Response) => {
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
      phone: phoneValidation.required().messages({
        'any.required': '"phone" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const user = await userService.createSeller(req.user as IAdmin, req.body as any);
    return res.status(CREATED).json({user});
  } catch (error) {
    throw error;
  }
});

/**
 * Get users.
 */
router.get(p.getUsers, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EUserSortType.DATE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      userType: Joi.string().valid(EUserType.ADMIN, EUserType.BIDDER, EUserType.SELLER),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, userType } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (userType) {
      conditions.set('userType', userType);
    }
    
    const users = await userService.getUsers(conditions);
    return res.status(OK).json({users});
  } catch (error) {
    throw error;
  }
});

/**
 * Set Firebase Token ID for a user.
 */
router.put(p.setFirebaseTokenId, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object({
      tokenId: Joi.string().required().messages({
        'any.required': '"tokenId" is a required field'
      })
    }).required();

    // Validate schema against input
    Joi.assert(req.body, schema);

    const { tokenId } = req.body;
    await userService.setFirebaseTokenId(req.user as IUser, tokenId);
    return res.status(OK).json({ "message": "ok" });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;
