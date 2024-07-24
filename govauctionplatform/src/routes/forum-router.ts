import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import forumService from '../services/forum-service';
import { mongoIdValidation } from '../shared/functions';
import { SuperAdminOnly, BidderOnly } from '../shared/middleware';
import { EAdminType, EUserType } from '../globals';
import { IAdmin, IBidder } from '../models/user-model';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
    createForum: '/createForum',
    getForumByAuctionId: '/getForumByAuctionId',
    createForumComment: '/createForumComment',
    getForumComments: '/getForumComments',
    deleteForumCommentById: '/deleteForumCommentById'
} as const;

/**
 * Create forum.
 */
router.post(p.createForum, async (req: Request, res: Response) => {
    try {
        const schema = Joi.object({
            auctionId: mongoIdValidation.required().messages({
                'any.required': '"auctionId" is a required field'
            })
        }).required();

        // Validate schema against input
        Joi.assert(req.body, schema);

        const forum = await forumService.createForum(req.body);
        return res.status(CREATED).json({ forum });
    } catch (error) {
        throw error;
    }
});

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

// Export default
export default router;
