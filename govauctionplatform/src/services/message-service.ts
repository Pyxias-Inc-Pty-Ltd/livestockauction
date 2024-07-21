import { IBidder } from "../models/user-model";
import itemService from "./item-service";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { EMessageSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { IMessage, IMessageInput, Message } from "../models/message-model";

/**
 * Creates a new message and saves it to the database.
 *
 * @param {IBidder} currentUser The currently logged-in user object.
 * @param {IMessageInput} input The message data to be created.
 * @returns {Promise<IMessage>} A promise that resolves to the newly created message document.
 * @throws {NotFoundError} Thrown if the item referenced in the input is not found.
 * @throws {ForbiddenError} Thrown if the current user is not an eligible bidder for the item.
 * @throws {Error} Any other errors encountered during message creation.
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
 * Retrieves a list of messages based on provided conditions.
 *
 * @param {Map<string, any>} conditions A map containing filtering parameters for message retrieval.
 *  - `itemId`: (Optional) The ID of the item to filter messages by.
 *  - `startDate`: (Optional) The start date for filtering messages by creation date.
 *  - `endDate`: (Optional) The end date for filtering messages by creation date.
 *  - `limit`: (Optional) The maximum number of messages to return (must be between 1 and MAX_LIST_LIMIT_NUMBER).
 *  - `sortBy`: (Optional) The field to sort messages by (currently only supports 'DATE').
 *  - `sortOrder`: (Optional) The sort order (either 'ASC' or 'DESC').
 *  - `lastDocumentId`: (Optional) Used for pagination, specifies the ID of the last message retrieved in the previous request.
 * @param {object} projection (Optional) A projection object to specify which fields to include in the retrieved messages.
 * @returns {Promise<IMessage[]>} A promise that resolves to an array of message documents matching the search criteria.
 * @throws {ForbiddenError} Thrown if the provided `limit` exceeds the allowed maximum.
 * @throws {Error} Any other errors encountered during message retrieval.
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

/**
 * Updates the `isRead` flag of a message to `true`.
 *
 * @param {string} messageId The ID of the message to update.
 * @returns {Promise<IMessage | null>} A promise that resolves to the updated message document or null if not found.
 * @throws {Error} Any errors encountered during the update process.
 */
async function updateIsRead(messageId: string): Promise<IMessage | null> {
  try {
    const message = await Message.findByIdAndUpdate(messageId, { $set: { isRead: true } }, { new: true });
    return message;
  } catch (error) {
    throw error;
  }
}


// Export default
export default {
  createMessage,
  getMessages,
  updateIsRead
} as const;