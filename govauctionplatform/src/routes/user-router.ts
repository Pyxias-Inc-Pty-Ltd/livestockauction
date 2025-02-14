import { BidderOnly, SellerOnly, SuperAdminOnly } from '../shared/middleware';
import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import { isStringNumberLike, mongoIdValidation, phoneValidation } from '../shared/functions';
import userService from '../services/user-service';
import { IAdmin, IBidder, ISeller, IUser } from '../models/user-model';
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
  getUserReport: '/getUserReport',
  updatePassword: '/updatePassword',
  createAdmin: '/createAdmin',
  createSeller: '/createSeller',
  getAdminById: '/getAdminById',
  getBidderById: '/getBidderById',
  deleteAdminById: '/deleteAdminById',
  deleteBidderById: '/deleteBidderById',
  setFirebaseTokenId: '/setFirebaseTokenId',
  verifyIdentityNumber: '/verifyIdentityNumber',
  getUserById: '/getUserById',
  beginBAITSKeeperIDVerification: '/beginBAITSKeeperIDVerification',
  finishBAITSKeeperIDVerification: '/finishBAITSKeeperIDVerification',
  createAuctionApprover: '/createAuctionApprover',
  getAuctionApprovers: '/getAuctionApprovers',
  updateAuctionApproverStatus: '/updateAuctionApproverStatus',
  getAuctionApproverById: '/getAuctionApproverById'
} as const;

/**
 * Get a category by id.
 */
router.get(p.getUserById, SuperAdminOnly(), async (req: Request, res: Response) => {
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
    const user = await userService.getById(id as string);
    return res.status(OK).json({ user });
  } catch (error) {
    throw error;
  }
});

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
      name: Joi.string().required().messages({
        'any.required': '"name" is a required field'
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
 * Verify identity number
 */
router.post(p.verifyIdentityNumber, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      userId: mongoIdValidation.required().messages({
        'any.required': '"userId" is a required field'
      }),
      hash: Joi.string().hex().required().messages({
        'any.required': '"hash" is a required field'
      }),
      signature: Joi.string().base64().required().messages({
        'any.required': '"signature" is a required field'
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
 * Begin BAITS keeper Id verification
 */
router.post(p.beginBAITSKeeperIDVerification, BidderOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      keeperId: Joi.string().required().messages({
        'any.required': '"keeperId" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const { keeperId } = req.body;

    await userService.beginBAITSKeeperIDVerification(req.user as IBidder, keeperId);
    return res.status(OK).json({"message":"ok"});
  } catch (error) {
    throw error;
  }
});

/**
 * Finish BAITS keeper Id verification
 */
router.post(p.finishBAITSKeeperIDVerification, BidderOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      otp: Joi.string().required().messages({
        'any.required': '"otp" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const { otp } = req.body;

    const result = await userService.finishBAITSKeeperIDVerification(req.user as IBidder, otp);
    return res.status(OK).json({"result":result});
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

/**
 * Get user report
 */
router.get(p.getUserReport, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {
    const report = await userService.getUserReport();
    return res.status(OK).json({ report });
  } catch (error) {
    throw error;
  }
});

router.post(p.createAuctionApprover, SellerOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      email: Joi.string().required().messages({
        'any.required': '"email" is a required field'
      }),
      firstName: Joi.string().required().messages({
        'any.required': '"firstName" is a required field'
      }),
      lastName: Joi.string().required().messages({
        'any.required': '"lastName" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const approver = await userService.createAuctionApprover(req.user as ISeller, req.body);
    return res.status(CREATED).json({ approver });
  } catch (error) {
    throw error;
  }
});

/**
 * Get auction approvers for current seller
 */
router.get(p.getAuctionApprovers, SellerOnly(), async (req: Request, res: Response) => {
  try {
    const approvers = await userService.getAuctionApproversForSeller((req.user as ISeller).id);
    return res.status(OK).json({ approvers });
  } catch (error) {
    throw error;
  }
});

/**
 * Get auction approvers for current seller
 */
router.get(p.getAuctionApprovers, SellerOnly(), async (req: Request, res: Response) => {
  try {
    const approvers = await userService.getAuctionApproversForSeller((req.user as ISeller).id);
    return res.status(OK).json({ approvers });
  } catch (error) {
    throw error;
  }
});

/**
 * Update auction approver status
 */
router.put(p.updateAuctionApproverStatus, SellerOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      approverId: mongoIdValidation.required().messages({
        'any.required': '"approverId" is a required field'
      }),
      isActive: Joi.boolean().required().messages({
        'any.required': '"isActive" is a required field'
      })
    }).required();
    
    // Validate schema against body
    Joi.assert(req.body, schema);

    const { approverId, isActive } = req.body;
    
    const approver = await userService.updateAuctionApproverStatus(
      req.user as ISeller,
      approverId,
      isActive
    );
    return res.status(OK).json({ approver });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;
