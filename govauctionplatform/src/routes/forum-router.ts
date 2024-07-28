import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import forumService from '../services/forum-service';
import { isStringNumberLike, mongoIdValidation } from '../shared/functions';
import { SuperAdminOnly, BidderOnly } from '../shared/middleware';
import { EAdminType, EForumCommentSortType, ESortOrderType, EUserType } from '../globals';
import { IAdmin, IBidder } from '../models/user-model';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
    getForumByAuctionId: '/getForumByAuctionId',
    createForumComment: '/createForumComment',
    getForumComments: '/getForumComments',
    deleteForumCommentById: '/deleteForumCommentById'
} as const;

/**
 * Get forum by auction ID.
 */
router.get(p.getForumByAuctionId, SuperAdminOnly(), BidderOnly(`Current user must be an admin of type ${EAdminType.SUPER} or user of type ${EUserType.BIDDER}`), async (req: Request, res: Response) => {
    try {
        // Query checks
        const qSchema = Joi.object().keys({
            auctionId: Joi.string().required().messages({
                'any.required': '"auctionId" is a required field'
            })
        }).required();

        // Validate schema against query
        Joi.assert(req.query, qSchema);

        const { auctionId } = req.query;
        const forum = await forumService.getForumByAuctionId(auctionId as string);
        return res.status(OK).json({ forum });
    } catch (error) {
        throw error;
    }
});

/**
 * Create forum comment.
 */
router.post(p.createForumComment, SuperAdminOnly(), BidderOnly(`Current user must be an admin of type ${EAdminType.SUPER} or user of type ${EUserType.BIDDER}`),async (req: Request, res: Response) => {
    try {
        const schema = Joi.object({
            forumId: mongoIdValidation.required().messages({
                'any.required': '"forumId" is a required field'
            }),
            content: Joi.string().required().messages({
                'any.required': '"content" is a required field'
            })
        }).required();

        // Validate schema against input
        Joi.assert(req.body, schema);

        const comment = await forumService.createForumComment(req.user as IBidder | IAdmin, req.body);
        return res.status(CREATED).json({ comment });
    } catch (error) {
        throw error;
    }
});

/**
 * Delete forum comment by id.
 */
router.delete(p.deleteForumCommentById, SuperAdminOnly(), BidderOnly(`Current user must be an admin of type ${EAdminType.SUPER} or user of type ${EUserType.BIDDER}`), async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Validate ID
        Joi.assert(id, mongoIdValidation.required().messages({
            'any.required': '"id" is a required field'
        }));

        await forumService.deleteForumComment(id);
        return res.status(OK).json({ "message": "ok" });
    } catch (error) {
        throw error;
    }
});

/**
 * Get Forum comments.
 */
router.get(p.getForumComments, BidderOnly(), SuperAdminOnly(), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EForumCommentSortType.DATE).messages({
        'any.required': '"sortBy" is a required field'
      }),
      forumId: mongoIdValidation.required().messages({
        'any.required': '"forumId" is a required field'
      }),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, forumId } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);
    conditions.set('forumId', forumId);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    const comments = await forumService.getForumComments(conditions);
    return res.status(OK).json({comments});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;
