import {Schema} from "mongoose";
import {
  INotificationTrigger,
  INotificationTriggerInput,
  NotificationTrigger
} from "../models/notification-trigger-model";

/**
 * Gets a notification trigger by name
 * 
 * @param name
 * @param projection
 */
export async function getNotificationTriggerByName(name: string, projection?: any): Promise<INotificationTrigger | null> {
  try {
    return await NotificationTrigger.findOne({name: name}, projection);
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Add one notification trigger.
 * 
 * @param input 
 * @returns 
 */
async function addOne(input: INotificationTriggerInput): Promise<INotificationTrigger> {
  try {
    const notificationTrigger = new NotificationTrigger(input);
    return await notificationTrigger.save();
  } catch (error) {
    throw error;
  }
}

/**
 * Delete a notification trigger by it's id.
 * 
 * @param id 
 * @returns 
 */
async function deleteOne(id: string | Schema.Types.ObjectId): Promise<void> {
  try {
    await NotificationTrigger.findByIdAndRemove(id);
    return;
  } catch (error) {
    throw error;
  }
}

// Export default
export default {
  delete: deleteOne,
  getNotificationTriggerByName,
  addOne
} as const;