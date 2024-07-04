import { IBidder } from '../models/user-model';
import bidService from '../services/bid-service';
import { IBidInput, IBid } from '../models/bid-model';

export default {
  createBid: async function (socket: any, data: IBidInput): Promise<IBid> {
    try {
      const bidder = socket.user as IBidder;

      const bid = await bidService.createBid(bidder, data);

      // TODO: Remove
      console.log("createBid: ", bid);
      return bid;
    } catch (error) {
      throw error;
    }
  },
  joinBiddingRoom: function (socket: any, data: string): undefined {
    try {
      socket.join(`${data}-bid`);
      return;
    } catch (error) {
      throw error;
    }
  },
  joinBiddingRoomChat: function (socket: any, data: string): undefined {
    try {
      socket.join(`${data}-chat`);
      return;
    } catch (error) {
      throw error;
    }
  }
} as const;