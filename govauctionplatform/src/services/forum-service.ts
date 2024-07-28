import { IForum, Forum, IForumInput } from '../models/forum-model';
import { IForumComment, ForumComment, IForumCommentInput } from '../models/forum-model';
import { ForbiddenError, NotFoundError } from '../shared/errors';
import { ClientSession, Schema, startSession } from 'mongoose';
import { EForumCommentSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from '../globals';
import { isMongoId } from 'validator';
import { IAdmin, IBidder } from '../models/user-model';
import userService from "./user-service";

/**
 * Create a forum.
 *
 * @param input
 * @param sess
 * @returns
 */
async function createForum(input: IForumInput, sess: ClientSession): Promise<IForum> {
    try {
        const newForum = new Forum(input);

        // Add admins to the forum
        const users = await userService.getAdmins({ _id: 1 });

        if (users.length > 0) {
          for (let i = 0; i < users.length; i++) {
            newForum.participants.push(users[i]._id);
          }
        }

        await newForum.save({ session: sess });
        return newForum;
    } catch (error) {
        throw error;
    }
}

/**
 * Get a forum by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IForum | null> {
  try {
    if (isMongoId(id.toString())) {
      const forum = await Forum.findById(id, projection);
      return forum;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get a forum by auction ID.
 *
 * @param auctionId
 * @param projection
 * @returns
 */
async function getForumByAuctionId(auctionId: string | Schema.Types.ObjectId, projection?: any): Promise<IForum | null> {
    try {
        if (isMongoId(auctionId.toString())) {
            const forum = await Forum.findOne({ auctionId }, projection);
            return forum;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

/**
 * Update a forum by ID.
 *
 * @param id
 * @param updateData
 * @returns
 */
async function updateForum(id: string | Schema.Types.ObjectId, updateData: Partial<IForum>): Promise<IForum | null> {
    try {
        if (isMongoId(id.toString())) {
            const forum = await Forum.findByIdAndUpdate(id, updateData, { new: true }).exec();
            return forum;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

/**
 * Delete a forum by ID.
 *
 * @param id
 * @returns
 */
async function deleteForum(id: string | Schema.Types.ObjectId): Promise<IForum | null> {
    try {
        if (isMongoId(id.toString())) {
            const forum = await Forum.findByIdAndDelete(id).exec();
            return forum;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

/**
 * Create a forum comment.
 *
 * @param input
 * @returns
 */
async function createForumComment(currentUser: IAdmin | IBidder, input: IForumCommentInput): Promise<IForumComment> {
    let sess: ClientSession | null = null;

    try {
        input.authorId = currentUser.id;
        // TODO: Check if bidder is in list of eligible items for an of the items under the supplied action
        const newComment = new ForumComment(input);

        // Start session and mongo acid transaction
        sess = await startSession();

        await sess.withTransaction(async () => {
            await newComment.save({ session: sess });
        });

        return newComment;
    } catch (error) {
        throw error;
    } finally {
        if (sess) {
            // End session
            await sess.endSession();
        }
    }
}

/**
 * Get a forum comment by ID.
 *
 * @param id
 * @returns
 */
async function getForumCommentById(id: string | Schema.Types.ObjectId): Promise<IForumComment | null> {
    try {
        if (isMongoId(id.toString())) {
            const comment = await ForumComment.findById(id).exec();
            return comment;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

/**
 * Update a forum comment by ID.
 *
 * @param id
 * @param updateData
 * @returns
 */
async function updateForumComment(id: string | Schema.Types.ObjectId, updateData: Partial<IForumComment>): Promise<IForumComment | null> {
    try {
        if (isMongoId(id.toString())) {
            const comment = await ForumComment.findByIdAndUpdate(id, updateData, { new: true }).exec();
            return comment;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

/**
 * Delete a forum comment by ID.
 *
 * @param id
 * @returns
 */
async function deleteForumComment(id: string | Schema.Types.ObjectId): Promise<IForumComment | null> {
    try {
        if (isMongoId(id.toString())) {
            // TODO: Make sure a user can only delete their own comment if they are not an admin
            const comment = await ForumComment.findByIdAndDelete(id).exec();
            return comment;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

/**
 * Retrieves a list of forum comments based on provided conditions.
 *
 * @param conditions
 * @param projection
 * @returns
 */
async function getForumComments(conditions: Map<string, any>, projection?: any): Promise<IForumComment[]> {
  try {
    let _limit: number = LIST_LIMIT_NUMBER;

    // Set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Query builder
    const q = ForumComment.find({}, projection);

    // Filters
    if (conditions.get('forumId')) {
      q.where({ forumId: conditions.get('forumId') });
    }

    // Range
    if (conditions.get('startDate') && conditions.get('endDate')) {
      q.and([{ 'createdDate': { $gte: new Date(conditions.get('startDate')) } }, { 'createdDate': { $lte: new Date(conditions.get('endDate')) } }]);
    } else if (conditions.get('startDate')) {
      q.where({ 'createdDate': { $gte: new Date(conditions.get('startDate')) } });
    } else if (conditions.get('endDate')) {
      q.where({ 'createdDate': { $lte: new Date(conditions.get('endDate')) } });
    }

    // Sort
    if (conditions.get('sortBy')) {
      if (conditions.get('sortBy') === EForumCommentSortType.DATE) {
        q.sort({'_id': conditions.get('sortOrder')});
      }
    }

    // Pagination
    if (conditions.get('lastDocumentId')) {
      // Check the sort order
      if (conditions.get('sortOrder') === ESortOrderType.ASC || conditions.get('sortOrder') === ESortOrderType.asc) {
        q.where("_id").gt(conditions.get('lastDocumentId'));
      } else {
        q.where("_id").lt(conditions.get('lastDocumentId'));
      }
    }

    // Limit
    q.limit(_limit);

    return await q;

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

// Export default
export default {
    createForum,
    getById,
    getForumByAuctionId,
    updateForum,
    deleteForum,
    createForumComment,
    getForumCommentById,
    updateForumComment,
    deleteForumComment,
    getForumComments
} as const;
