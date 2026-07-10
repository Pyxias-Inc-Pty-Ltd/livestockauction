import { requirePermission } from '../shared/middleware';
import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import { isStringNumberLike, mongoIdValidation, phoneValidation } from '../shared/functions';
import userService from '../services/user-service';
import { IAdmin, IBidder, ISeller, IUser, User } from '../models/user-model';
import { InternalServerError } from '../shared/errors';
import { EPermission, ESortOrderType, EUserSortType, EUserType } from '../globals';
import { resetKeycloakUserPassword } from '../shared/keycloak';

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
  getAuctionApproverById: '/getAuctionApproverById',
  updateSellerAttributes: '/updateSellerAttributes',
  removeBlacklist: '/removeBlacklist',
  getBlacklistedUsers: '/getBlacklistedUsers',
} as const;

/**
 * Get a category by id.
 */
router.get(p.getUserById, requirePermission(EPermission.USER_READ), async (req: Request, res: Response) => {
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
router.post(p.createSeller, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
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
 * Verify identity number of the authenticated user against the government CIPA / Omang API.
 */
router.post(p.verifyIdentityNumber, requirePermission(EPermission.USER_VERIFY_SELF), async (req: Request, res: Response) => {
  try {
    await userService.verifyIdentityNumber(req.user!.id.toString());
    return res.status(OK).json({ message: 'ok' });
  } catch (error) {
    throw error;
  }
});

/**
 * Begin BAITS keeper Id verification
 */
router.post(p.beginBAITSKeeperIDVerification, requirePermission(EPermission.USER_VERIFY_SELF), async (req: Request, res: Response) => {
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
router.post(p.finishBAITSKeeperIDVerification, requirePermission(EPermission.USER_VERIFY_SELF), async (req: Request, res: Response) => {
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
router.get(p.getUsers, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
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
    
    const [users, totalCount] = await Promise.all([
      userService.getUsers(conditions),
      userService.countUsers(conditions),
    ]);
    return res.status(OK).json({users, totalCount});
  } catch (error) {
    throw error;
  }
});

/**
 * Update own password via Keycloak Admin API.
 * The user must supply their new password; Keycloak handles validation.
 */
router.put(p.updatePassword, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      newPassword: Joi.string().min(8).required().messages({
        'any.required': '"newPassword" is a required field',
        'string.min': '"newPassword" must be at least 8 characters',
      }),
    }).required();

    Joi.assert(req.body, schema);

    const user = req.user as IUser;
    if (!user.keycloakId) {
      throw new InternalServerError('User has no Keycloak account linked');
    }

    await resetKeycloakUserPassword(user.keycloakId, req.body.newPassword, false);
    return res.status(OK).json({ message: 'Password updated successfully' });
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
router.get(p.getUserReport, requirePermission(EPermission.USER_REPORT), async (req: Request, res: Response) => {
  try {
    const report = await userService.getUserReport();
    return res.status(OK).json({ report });
  } catch (error) {
    throw error;
  }
});

router.post(p.createAuctionApprover, requirePermission(EPermission.USER_APPROVER_MANAGE), async (req: Request, res: Response) => {
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
router.get(p.getAuctionApprovers, requirePermission(EPermission.USER_APPROVER_READ), async (req: Request, res: Response) => {
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
router.get(p.getAuctionApprovers, requirePermission(EPermission.USER_APPROVER_READ), async (req: Request, res: Response) => {
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
router.put(p.updateAuctionApproverStatus, requirePermission(EPermission.USER_APPROVER_MANAGE), async (req: Request, res: Response) => {
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

/**
 * Get an auction approver by ID.
 */
router.get(p.getAuctionApproverById, requirePermission(EPermission.USER_APPROVER_READ), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      id: Joi.string().required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    Joi.assert(req.query, qSchema);

    const { id } = req.query;
    const approver = await userService.getAuctionApproverById(id as string);

    if (!approver) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Auction approver not found' });
    }

    return res.status(OK).json({ approver });
  } catch (error) {
    throw error;
  }
});

/**
 * Delete an admin by ID (also removes from Keycloak).
 */
router.delete(p.deleteAdminById, requirePermission(EPermission.USER_DELETE), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      id: mongoIdValidation.required().messages({
        'any.required': '"id" is a required field',
      }),
    }).required();
    Joi.assert(req.query, qSchema);

    await userService.deleteUser(req.query.id as string);
    return res.status(OK).json({ message: 'Admin deleted' });
  } catch (error) {
    throw error;
  }
});

/**
 * Delete a bidder by ID (also removes from Keycloak).
 */
router.delete(p.deleteBidderById, requirePermission(EPermission.USER_DELETE), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      id: mongoIdValidation.required().messages({
        'any.required': '"id" is a required field',
      }),
    }).required();
    Joi.assert(req.query, qSchema);

    await userService.deleteUser(req.query.id as string);
    return res.status(OK).json({ message: 'Bidder deleted' });
  } catch (error) {
    throw error;
  }
});

/**
 * Search bidders by name, email, phone, or keeperId.
 */
router.get(p.getBidders, requirePermission(EPermission.USER_BIDDER_READ), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      search: Joi.string().min(1).required().messages({
        'any.required': '"search" is a required field',
      }),
      limit: Joi.number().integer().min(1).max(100).default(20),
    }).required();

    Joi.assert(req.query, qSchema);

    const { search, limit } = req.query;
    const bidders = await userService.searchBidders(search as string, Number(limit));
    return res.status(OK).json({ bidders });
  } catch (error) {
    throw error;
  }
});

/**
 * Get a bidder by ID.
 */
router.get(p.getBidderById, requirePermission(EPermission.USER_BIDDER_READ), async (req: Request, res: Response) => {
  try {
    const qSchema = Joi.object().keys({
      id: mongoIdValidation.required().messages({
        'any.required': '"id" is a required field',
      }),
    }).required();

    Joi.assert(req.query, qSchema);

    const { id } = req.query;
    const bidder = await userService.getById(id as string);

    if (!bidder) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Bidder not found' });
    }

    return res.status(OK).json({ bidder });
  } catch (error) {
    throw error;
  }
});

/**
 * Update allowed required attributes for a seller (admin only)
 */
router.put(p.updateSellerAttributes, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      sellerId: mongoIdValidation.required().messages({
        'any.required': '"sellerId" is a required field'
      }),
      allowedRequiredAttributes: Joi.array().items(mongoIdValidation).required().messages({
        'any.required': '"allowedRequiredAttributes" is a required field'
      }),
    }).required();

    Joi.assert(req.body, schema);

    const { sellerId, allowedRequiredAttributes } = req.body;
    const seller = await userService.updateSellerAllowedAttributes(sellerId, allowedRequiredAttributes);
    return res.status(OK).json({ seller });
  } catch (error) {
    throw error;
  }
});

/**
 * Remove blacklist flag from a user (admin only).
 */
router.put(p.removeBlacklist, requirePermission(EPermission.USER_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      userId: mongoIdValidation.required().messages({
        'any.required': '"userId" is a required field',
      }),
    }).required();

    Joi.assert(req.body, schema);

    const { userId } = req.body;
    const user = await userService.removeBlacklist(userId);
    return res.status(OK).json({ user });
  } catch (error) {
    throw error;
  }
});

/**
 * Get all blacklisted users (admin only).
 */
router.get(p.getBlacklistedUsers, requirePermission(EPermission.USER_READ), async (req: Request, res: Response) => {
  try {
    const users = await User.find({ blacklisted: true });
    return res.status(OK).json({ users });
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;
