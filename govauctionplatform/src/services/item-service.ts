import { IAdmin, IUser } from "../models/user-model";
import { IItem, IItemInput, Item } from "../models/item-model";
import { isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, InternalServerError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { Schema } from 'mongoose';
import { EItemSortType, EItemStatus, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import auctionService from "./auction-service";
import { ClientSession, startSession } from 'mongoose';
import bidService from "./bid-service";

/**
 * Add an item.
 * 
 * @param input
 * @returns 
 */
async function createItem(currentUser: IAdmin, input: IItemInput): Promise<IItem> {

  let sess: ClientSession | null = null;

  try {
    const newItem = new Item(input);

    newItem.creatorId = currentUser.id;

    if (newItem.isBidIncrementedManually) {
      newItem.manualBidAmount = newItem.startingBid;
    }

    // TOOD: Should we have a buffer window? e.g. You can not create an item 2 hours before auction starts?

    if (!isBeforeStartDate(new Date(), new Date(input.startTime))) {
      throw new ForbiddenError('Start time must not come before the current time');
    }

    if (!isStartDateBeforeEndDate(new Date(input.startTime), new Date(input.endTime))) {
      throw new ForbiddenError('End time must not come before the start time');
    }

    // Find auction
    const auction = await auctionService.getById(input.auctionId);

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    // Check status
    if (auction.status !== 'NOT_BEGUN') {
      throw new ForbiddenError('Can not add an item to a processed auction');
    }

    newItem.status = 'NOT_BEGUN';
    newItem.categoryId = auction.categoryId;

    auction.numberOfLots += 1;

    // Start session and mongo acid transaction
    sess = await startSession();

    await sess.withTransaction(async () => {

      await newItem.save({
        session: sess
      });

      await auction.save({
        session: sess
      });

    });

    return newItem;
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
 * Delete an item by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function deleteItem(currentUser: IAdmin, itemId: string | Schema.Types.ObjectId): Promise<undefined> {
  try {
    if (isMongoId(itemId.toString())) {

      const item = await getById(itemId);

      if (item) {
        // Check status
        if (item.status === 'NOT_BEGUN') {
          await Item.findByIdAndDelete(itemId);
          return;
        } else {
          throw new ForbiddenError('Can not delete a processed item');
        }
      } else {
        return;
      }

    } else {
      return;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Sets the new bid amount manually.
 * 
 * @param amount
 * @returns 
 */
async function setNewBidAmountManually(input: { itemId: string | Schema.Types.ObjectId, amount: number }): Promise<IItem> {
  try {

    // Find item
    const item = await getById(input.itemId);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (!item.isBidIncrementedManually) {
      throw new ForbiddenError('Bid amount can not be set manually on this item');
    }

    item.manualBidAmount = input.amount;

    return await item.save();
    
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get manual bid amount.
 * 
 * @param amount
 * @returns 
 */
async function getManualBidAmount(itemId: string | Schema.Types.ObjectId): Promise<number> {
  try {
    
    // Find item
    const item = await getById(itemId, { manualBidAmount: 1 });

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    return item.manualBidAmount;

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get an item by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IItem | null> {
  try {
    if (isMongoId(id.toString())) {
      const item = await Item.findById(id, projection);
      return item;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Set the winning bidder of a lot in an auction
 * 
 * @param input 
 */
async function setWinningBidder(input: { itemId: string | Schema.Types.ObjectId, bidderId: string | Schema.Types.ObjectId }): Promise<IItem> {
  try {

    // TODO: Check if auction is over

    // Find item
    const item = await getById(input.itemId);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (item.eligibleBidders.indexOf(input.bidderId.toString()) === -1) {
      throw new ForbiddenError('Bidder must be in list of eligible bidders');
    }

    const conditions = new Map<string, any>();

    conditions.set('itemId', item.id);

    // Get bids
    const bids = await bidService.getBids(conditions);

    // Check length
    if (bids.length < 1) {
      throw new InternalServerError('Bids are empty');
    }

    const highestBid = bids[0];

    // Check if bidder supplied is the highest bidder
    if (highestBid.userId.toString() !== input.bidderId.toString()) {
      throw new ForbiddenError('Bidder supplied is not the highest bidder');
    }

    item.winningBidder = input.bidderId as any;

    return await item.save();

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

async function updateItemWithBid(item: IItem, newBidAmount: number, session: ClientSession): Promise<boolean> {
  const result = await Item.updateOne(
    { _id: item._id, version: item.version },
    { $set: { currentBid: newBidAmount }, $inc: { version: 1 } },
    { session }
  );

  return result.modifiedCount === 1;
}

/**
 * Get items.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getItems(conditions: Map<string, any>, projection?: any): Promise<IItem[]> {
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
    const q = Item.find({}, projection);

    // Filters
    if (conditions.get('categoryId')) {
      q.where({categoryId: conditions.get('categoryId')});
    }

    if (conditions.get('auctionId')) {
      q.where({auctionId: conditions.get('auctionId')});
    }

    if (conditions.get('status')) {
      q.where({status: conditions.get('status')});
    } else {
      q.or([{status: EItemStatus.ACTIVE}, {status: EItemStatus.NOT_BEGUN}, {status: EItemStatus.ENDED}]);
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
      if (conditions.get('sortBy') === EItemSortType.DATE) {
        q.sort({'_id': conditions.get('sortOrder')});
      }
      if (conditions.get('sortBy') === EItemSortType.RESERVE_PRICE) {
        q.sort({'reservePrice': conditions.get('sortOrder')});
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
  createItem,
  setWinningBidder,
  updateItemWithBid,
  getManualBidAmount,
  setNewBidAmountManually,
  deleteItem,
  getById,
  getItems
} as const;