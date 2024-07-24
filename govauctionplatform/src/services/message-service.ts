import { IAdmin, IBidder } from "../models/user-model";
import { ForbiddenError } from "../shared/errors";
import { EMessageSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { IMessage, IMessageInput, Message } from "../models/message-model";

/**
 * Create a chat message.
 */
async function createMessage(currentUser: IBidder | IAdmin, input: IMessageInput): Promise<IMessage> {
  try {
    
    input.authorId = currentUser.id;
    const newMessage = new Message(input);
    return await newMessage.save();

  } catch (error) {
    throw error;
  }
}

/**
 * Retrieves a list of messages based on provided conditions.
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
    if (conditions.get('adminId') && conditions.get('bidderId')) {
      q.and([{adminId: conditions.get('adminId')}, {bidderId: conditions.get('bidderId')}]);
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