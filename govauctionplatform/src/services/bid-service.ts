import { IBidder } from "../models/user-model";
import { Bid, IBid, IBidInput } from "../models/bid-model";
import itemService from "./item-service";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { ClientSession, Schema, startSession } from 'mongoose';
import { EBidSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { isMongoId } from "validator";
import auctionService from "./auction-service";

/**
 * Add a bid.
 * 
 * @param currentUser The bidder placing the bid
 * @param input Bid input data
 * @returns The created bid
 */
async function createBid(currentUser: IBidder, input: IBidInput): Promise<IBid> {
  let sess: ClientSession | null = null;

  try {
    let item = await itemService.getById(input.itemId);

    // Check if item exists
    if (!item) throw new NotFoundError('Item not found');

    // Check eligibility for bidding
    if (!item.eligibleBidders.includes(currentUser.id.toString())) {
      throw new ForbiddenError('Not eligible for bidding');
    }

    // Check auction status
    const now = new Date();
    if (item.status === 'NOT_BEGUN') throw new ForbiddenError('Bidding for this lot has not begun');
    if (item.status === 'ENDED') throw new ForbiddenError('Bidding for this lot has already ended');
    if (item.status === 'CANCELLED') throw new ForbiddenError('Bidding for this lot has been cancelled');

    // For closed bidding, check if the bidder has already placed a bid
    if (item.isClosedBidding) {
      const existingBid = await Bid.findOne({ 
        userId: currentUser.id, 
        itemId: item.id,
        isRetracted: { $ne: false }
      });
      
      if (existingBid) {
        throw new ForbiddenError('In closed bidding, you can only place one bid');
      }
    }

    if (!item.isBidIncrementedManually) {
      // Validate bid amount
      if (input.bidAmount <= item.startingBid) throw new ForbiddenError('Bid amount must be higher than the starting bid');
      if (item.currentBid && input.bidAmount <= item.currentBid) throw new ForbiddenError('Bid amount must be higher than the current bid');
    }

    const newBid = new Bid(input);
    newBid.userId = currentUser.id;
    newBid.bidTime = now;

    // Start session and mongo acid transaction
    sess = await startSession();

    await sess.withTransaction(async () => {
      // For closed bidding, we need to ensure the bidder hasn't placed a bid
      // since we checked (double-check within transaction)
      if (item!.isClosedBidding) {
        const existingBid = await Bid.findOne({ 
          userId: currentUser.id, 
          itemId: item!.id 
        }, null, { session: sess });
        
        if (existingBid) {
          throw new ForbiddenError('In closed bidding, you can only place one bid');
        }
      }

      // Update item with optimistic concurrency control
      const updateResult = await itemService.updateItemWithBid(item!, input.bidAmount, sess!);

      if (!updateResult) {
        throw new Error('Failed to update item due to version conflict. Please try again.');
      }

      await newBid.save({ 
        session: sess
      });
    });

    return newBid;
  } catch (error) {
    throw error;
  } finally {
    if (sess) {
      // End session
      await sess.endSession();
    }
  }
}

/**
 * Retract a bid.
 * 
 * @param currentUser 
 * @param bidId 
 * @returns 
 */
async function retractBid(currentUser: IBidder, bidId: string | Schema.Types.ObjectId): Promise<IBid> {
  try {
    const bid = await Bid.findOne({ _id: bidId, userId: currentUser.id });
    if (!bid) throw new NotFoundError('Bid not found');

    const item = await itemService.getById(bid.itemId);
    if (!item) throw new NotFoundError('Item not found');

    // Check auction status
    if (item.status !== 'ACTIVE') throw new ForbiddenError('Cannot retract bid after auction has ended or if it is not active');

    bid.isRetracted = true;

    return await bid.save();
  } catch (error) {
    throw error;
  }
}

/**
 * Get the winning bid
 * 
 * @param itemId 
 * @returns 
 */
async function getWinningBid(itemId: string | Schema.Types.ObjectId): Promise<IBid | null> {
  try {
    const conditions = new Map<string, any>();
    conditions.set('limit', 1);
    conditions.set('sortBy', EBidSortType.AMOUNT);
    conditions.set('sortOrder', ESortOrderType.DESC);
    conditions.set('itemId', itemId);

    const bids = await getBids(itemId.toString(), conditions);

    return bids.length > 0 ? bids[0] : null;
  } catch (error) {
    throw error;
  }
}

/**
 * Get bids.
 * 
 * @param itemId
 * @param conditions
 * @param projection
 * @returns 
 */
async function getBids(itemId: string, conditions: Map<string, any>, projection?: any): Promise<IBid[]> {
  try {
    let _limit: number = LIST_LIMIT_NUMBER;

    const item = await itemService.getById(itemId, { auctionId: 1 });

    // Check if exists
    if (!item) {
      throw new NotFoundError("Item not found");
    }

    const auction = await auctionService.getById(item.auctionId, { participantsWithBiddingNumbers: 1 });

    // Check if exists
    if (!auction) {
      throw new NotFoundError("Auction not found");
    }

    // Convert participantsWithBiddingNumbers array to a Map for quick lookup
    const biddingNumbersMap = new Map(
      auction.participantsWithBiddingNumbers.map(entry => {
        const [userId, bidNumber] = entry.split(":");
        return [userId, bidNumber];
      })
    );

    // Set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Query builder
    const q = Bid.find({}, projection);

    // Apply Filters
    q.where({ itemId, isRetracted: false });

    // Apply Date Range
    if (conditions.get('startDate') && conditions.get('endDate')) {
      q.and([{ 'createdDate': { $gte: new Date(conditions.get('startDate')) } }, { 'createdDate': { $lte: new Date(conditions.get('endDate')) } }]);
    } else if (conditions.get('startDate')) {
      q.where({ 'createdDate': { $gte: new Date(conditions.get('startDate')) } });
    } else if (conditions.get('endDate')) {
      q.where({ 'createdDate': { $lte: new Date(conditions.get('endDate')) } });
    }

    // Apply Sort
    if (conditions.get('sortBy')) {
      if (conditions.get('sortBy') === EBidSortType.DATE) {
        q.sort({ 'bidTime': conditions.get('sortOrder') });
      }
      if (conditions.get('sortBy') === EBidSortType.AMOUNT) {
        q.sort({ 'bidAmount': conditions.get('sortOrder') });
      }
    }

    // Apply Pagination
    if (conditions.get('lastDocumentId')) {
      // Check the sort order
      if (conditions.get('sortOrder') === ESortOrderType.ASC || conditions.get('sortOrder') === ESortOrderType.asc) {
        q.where("_id").gt(conditions.get('lastDocumentId'));
      } else {
        q.where("_id").lt(conditions.get('lastDocumentId'));
      }
    }

    // Apply Limit
    q.limit(_limit);

    // Execute the query
    const bids = await q.exec();

    // Only set bidNumber if participantsWithBiddingNumbers is not empty
    if (auction.participantsWithBiddingNumbers.length > 0) {
      bids.forEach((bid: IBid) => {
        const bidNumber = biddingNumbersMap.get(bid.userId.toString());
        if (bidNumber) {
          bid.bidNumber = bidNumber;
        }
      });
    }

    return bids;

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get a bid by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IBid | null> {
  try {
    if (isMongoId(id.toString())) {
      return await Bid.findById(id, projection);
    }
    return null;
  } catch (error) {
    throw error;
  }
}

// Export default
export default {
  getById,
  createBid,
  getBids,
  getWinningBid,
  retractBid
} as const;
