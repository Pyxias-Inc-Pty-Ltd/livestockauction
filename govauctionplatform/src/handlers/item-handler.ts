import itemService from '../services/item-service';
import { IItem } from '../models/item-model';
import { IUser } from '../models/user-model';
import { ForbiddenError } from '../shared/errors';
import { EUserType } from '../globals';

export default {
  setNewBidAmountManually: async function (socket: any, data: { itemId: string, amount: number }): Promise<IItem> {
    try {

      const user = socket.user as IUser;

      // Check if user
      if (user.userType !== 'ADMIN') {
        throw new ForbiddenError(`User must be of type ${EUserType.ADMIN}`)
      }

      const item = await itemService.setNewBidAmountManually(data);

      // TODO: Remove
      console.log("setNewBidAmountManually: ", item);
      return item;
    } catch (error) {
      throw error;
    }
  }
} as const;