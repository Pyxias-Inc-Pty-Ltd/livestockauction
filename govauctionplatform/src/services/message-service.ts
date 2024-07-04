import { IBidder } from "../models/user-model";
import itemService from "./item-service";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { EMessageSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { IMessage, IMessageInput, Message } from "../models/message-model";

/**
 * Add a message.
 * 
 * @param input
 * @returns 
 */
async function createMessage(currentUser: IBidder, input: IMessageInput): Promise<IMessage> {
  try {
    const item = await itemService.getById(input.itemId, { _id: 1, eligibleBidders: 1 });

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Check if is in eligible bidders
    if (item.eligibleBidders.lastIndexOf(currentUser.id.toString()) === -1) {
      throw new ForbiddenError('Not eligible for chat');
    }

    const newMessage = new Message(input);

    newMessage.message = `${currentUser.firstName} ${currentUser.lastName}: ${newMessage.message}`;

    return await newMessage.save();

  } catch (error) {
    throw error;
  }
}

/**
 * Get messages.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getMessages(conditions: Map<string, any>, projection?: any): Promise<IMessage[]> {
  try {

    let _limit: number = LIST_LIMIT_NUMBER;

    //set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Query builder
    const q = Message.find({}, projection);

    // Filters
    if (conditions.get('itemId')) {
      q.where({itemId: conditions.get('itemId')});
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
      if (conditions.get('sortBy') === EMessageSortType.DATE) {
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
  createMessage,
  getMessages
} as const;