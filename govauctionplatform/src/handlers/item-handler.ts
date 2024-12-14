import itemService from '../services/item-service';
import { IItem } from '../models/item-model';

export default {
  setNewBidAmountManually: async function (socket: any, data: { itemId: string, amount: number }): Promise<IItem> {
    try {
      const item = await itemService.setNewBidAmountManually(data);
      return item;
    } catch (error) {
      throw error;
    }
  }
} as const;