import { ForbiddenError } from "../shared/errors";
import { ClientSession } from "mongoose";
import { ENotificationSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { INotification, INotificationInput, Notification } from "../models/notification-model";
import { IUser } from "../models/user-model";

/**
 * Add notification.
 *
 * @param input
 * @param sess
 * @returns
 */
async function addOne(input: INotificationInput, sess: ClientSession): Promise<INotification> {
  try {
    const notification = new Notification(input);
    await notification.save({ session: sess });
    return notification;
  } catch (error) {
    throw error;
  }
}

/**
 * Retrieves a list a users own notifications.
 */
async function getOwnNotifications(currentUser: IUser, conditions: Map<string, any>, projection?: any): Promise<INotification[]> {
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
    const q = Notification.find({}, projection);

    // Filters
    q.where({ notifier: currentUser.id });

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
      if (conditions.get('sortBy') === ENotificationSortType.DATE) {
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
  addOne,
  getOwnNotifications
} as const;
