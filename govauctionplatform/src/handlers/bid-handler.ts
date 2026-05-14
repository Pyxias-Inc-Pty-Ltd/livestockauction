import { IBidder } from '../models/user-model';
import bidService from '../services/bid-service';
import { IBidInput, IBid } from '../models/bid-model';
import { Item } from '../models/item-model';
import { NotFoundError } from '../shared/errors';

export type BidMode = 'open' | 'livestream' | 'sealed';

export interface BidWithMode {
  bid: IBid;
  mode: BidMode;
}

export default {
  /**
   * Detect the auction mode from the item, then delegate to the correct
   * mode-specific service function.
   *
   * The mode detection here is advisory — the service functions re-fetch
   * the item inside their own transactions for authoritative state.  A
   * mode mismatch between this read and the transaction read is extremely
   * unlikely (item modes are set at creation and never change), but the
   * inner transaction will still enforce the correct rules.
   *
   * Mode routing:
   *   isClosedBidding               → Mode 3 (sealed)
   *   isBidIncrementedManually      → Mode 2 (livestream)
   *   otherwise                     → Mode 1 (open)
   */
  createBid: async function (socket: any, data: IBidInput): Promise<BidWithMode> {
    const bidder = socket.user as IBidder;

    const item = await Item.findById(data.itemId, {
      isBidIncrementedManually: 1,
      isClosedBidding: 1,
    });
    if (!item) throw new NotFoundError('Item not found');

    let bid: IBid;
    let mode: BidMode;

    if (item.isClosedBidding) {
      bid = await bidService.createSealedBid(bidder, data);
      mode = 'sealed';
    } else if (item.isBidIncrementedManually) {
      bid = await bidService.createLivestreamBid(bidder, data);
      mode = 'livestream';
    } else {
      bid = await bidService.createOpenBid(bidder, data);
      mode = 'open';
    }

    return { bid, mode };
  },

  retractBid: async function (socket: any, data: string): Promise<IBid> {
    const bidder = socket.user as IBidder;
    return await bidService.retractBid(bidder, data);
  },

  joinBiddingRoom: function (socket: any, data: string | { lotId: string }): undefined {
    try {
      const lotId = typeof data === 'string' ? data : data.lotId;
      socket.join(`${lotId}-bid`);
      return;
    } catch (error) {
      throw error;
    }
  },

  joinBiddingRoomChat: function (socket: any, data: string | { lotId: string }): undefined {
    try {
      const chatTarget = typeof data === 'string' ? data : data.lotId;
      socket.join(`${chatTarget}-chat`);
      return;
    } catch (error) {
      throw error;
    }
  },
} as const;
