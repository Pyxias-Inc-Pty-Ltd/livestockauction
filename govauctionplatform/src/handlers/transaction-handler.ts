import { IBidder } from '../models/user-model';
import { IBid } from '../models/bid-model';
import transactionService from '../services/transaction-service';
import { transactionType } from '../globals';

export default {
    pollPaidTransaction: async function (socket: any, input: { itemId: string, transactionType: transactionType }): Promise<boolean> {
    try {
      const bidder = socket.user as IBidder;
      return await transactionService.pollPaidTransaction(bidder, input);
    } catch (error) {
      throw error;
    }
  }
} as const;