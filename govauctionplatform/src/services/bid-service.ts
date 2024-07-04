import { IBidder } from "../models/user-model";
import { Bid, IBid, IBidInput } from "../models/bid-model";
import itemService from "./item-service";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { ClientSession, Schema, startSession } from 'mongoose';
import { EBidSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { isMongoId } from "validator";

/**
 * Add a bid.
 * 
 * @param input
 * @returns 
 */
async function createBid(currentUser: IBidder, input: IBidInput): Promise<IBid> {

  let sess: ClientSession | null = null;

  try {

    const item = await itemService.getById(input.itemId);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Check if is in eligible bidders
    if (item.eligibleBidders.lastIndexOf(currentUser.id.toString()) === -1) {
      throw new ForbiddenError('Not eligible for bidding');
    }

    const now = new Date();

    // Check the item status
    if (item.status === 'NOT_BEGUN') {
      throw new ForbiddenError('Auction has not begun');
    }
    if (item.status === 'ENDED') { // TODO: Have a cron job that updates this status
      throw new ForbiddenError('Auction has already ended');
    }
    if (item.status === 'CANCELLED') {
      throw new ForbiddenError('Auction has been cancelled');
    }

    if (item.startingBid > input.bidAmount) {
      throw new ForbiddenError('Bid amount must be higher than or equal to the starting bid');
    }

    if (item.currentBid) {
      if (item.currentBid >= input.bidAmount) {
        throw new ForbiddenError('Bid amount must be higher than the current bid');
      }
    }

    const newBid = new Bid(input);

    // Start session and mongo acid transaction
    sess = await startSession();

    await sess.withTransaction(async () => {

      newBid.userId = currentUser.id;
      newBid.bidTime = now;
  
      item.currentBid = input.bidAmount;

      await item.save({
        session: sess
      });
  
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

    const bids = await getBids(conditions);

    if (bids.length > 0) {
      return bids[0];
    } else {
      return null;
    }

  } catch (error) {
    throw error;
  }
}

/**
 * Get bids.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getBids(conditions: Map<string, any>, projection?: any): Promise<IBid[]> {
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
    const q = Bid.find({}, projection);

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
      if (conditions.get('sortBy') === EBidSortType.DATE) {
        q.sort({'bidTime': conditions.get('sortOrder')});
      }
      if (conditions.get('sortBy') === EBidSortType.AMOUNT) {
        q.sort({'bidAmount': conditions.get('sortOrder')});
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
 * Get a bid by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IBid | null> {
  try {
    if (isMongoId(id.toString())) {
      const bid = await Bid.findById(id, projection);
      return bid;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Delete a bid by id.
 * 
 * @param bidId 
 * @param projection
 * @returns 
 */
async function deleteBid(currentUser: IBidder, bidId: string | Schema.Types.ObjectId): Promise<undefined> {
  try {
    if (isMongoId(bidId.toString())) {
      await Bid.findOneAndDelete({ bidId, userId: currentUser.id });
    } else {
      return;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

// Export default
export default {
  deleteBid,
  createBid,
  getBids,
  getWinningBid
} as const;