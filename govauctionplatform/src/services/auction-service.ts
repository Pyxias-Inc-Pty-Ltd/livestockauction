import { IAdmin, IUser } from "../models/user-model";
import { isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { Schema } from 'mongoose';
import { EAuctionSortType, EItemStatus, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { Auction, IAuction, IAuctionInput } from "../models/auction-model";
import categoryService from "./category-service";
import itemService from "./item-service";

/**
 * Add an auction.
 * 
 * @param input
 * @returns 
 */
async function createAuction(currentUser: IAdmin, input: IAuctionInput): Promise<IAuction> {
  try {
    const newAuction = new Auction(input);

    newAuction.creatorId = currentUser.id;

    if (!isBeforeStartDate(new Date(), new Date(input.startTime))) {
      throw new ForbiddenError('Start time must not come before the current time');
    }

    if (!isStartDateBeforeEndDate(new Date(input.startTime), new Date(input.endTime))) {
      throw new ForbiddenError('End time must not come before the start time');
    }

    newAuction.status = 'NOT_BEGUN';

    // Find category
    const category = await categoryService.getById(input.categoryId, { _id: 1 });

    // Check if exists
    if (!category) {
      throw new NotFoundError('Category not found');
    }

    await newAuction.save();

    return newAuction;
  } catch (error) {
    throw error;
  }
}

/**
 * Delete an auction by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function deleteAuction(currentUser: IAdmin, auctionId: string | Schema.Types.ObjectId): Promise<undefined> {
  try {
    if (isMongoId(auctionId.toString())) {

      const auction = await getById(auctionId);

      if (auction) {
        // Check status
        if (auction.status === 'NOT_BEGUN') {
          await Auction.findByIdAndDelete(auctionId);
          return;
        } else if (auction.numberOfLots > 0) {
          throw new ForbiddenError('Delete all lots under an auction before deleting the auction');
        } {
          throw new ForbiddenError('Can not delete a processed auction');
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
 * Get an auction by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IAuction | null> {
  try {
    if (isMongoId(id.toString())) {
      const auction = await Auction.findById(id, projection);
      return auction;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Search for auctions
 * 
 * @param input 
 * @returns 
 */
async function searchAuctions (input: { term: string }): Promise<IAuction[]> {
  try {
    const pipeline = [
      {
        $search: {
          index: "default_auction_index",
          text: {
            query: input.term,
            path: {
              wildcard: "*",
            },
          },
        },
      },
    ];

    const result = await Auction.aggregate(pipeline);

    return await Promise.all(result.map((auction: any) => {
      auction.id = auction._id.toString();
      delete auction._id;
      return auction;
    }));

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get auctions.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getAuctions(conditions: Map<string, any>, projection?: any): Promise<IAuction[]> {
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
    const q = Auction.find({}, projection);

    // Filters
    if (conditions.get('categoryId')) {
      q.where({categoryId: conditions.get('categoryId')});
    }

    if (conditions.get('status')) {
      q.where({status: conditions.get('status')});
    } else {
      q.or([{status: EItemStatus.ACTIVE}, {status: EItemStatus.NOT_BEGUN}]);
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
      if (conditions.get('sortBy') === EAuctionSortType.DATE) {
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

/**
 * Gets an auction report
 * 
 * @param auctionId 
 * @returns 
 */
async function getAuctionReport(auctionId: string | Schema.Types.ObjectId): Promise<{
  boughtItemsCount: number,
  totalValueOfLotsBought: number,
  bidders: Array<IUser | null>
}> {
  try {
    const result = await Promise.all([itemService.countBoughtItems(auctionId), itemService.calculateTotalValueOfLotsBought(auctionId), itemService.getBiddersForAuction(auctionId)]);

    return {
      boughtItemsCount: result[0],
      totalValueOfLotsBought: result[1],
      bidders: result[2]
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

// Export default
export default {
  createAuction,
  deleteAuction,
  getById,
  getAuctions,
  searchAuctions,
  getAuctionReport
} as const;