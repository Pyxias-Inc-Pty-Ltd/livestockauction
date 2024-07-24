import { IAdmin } from "../models/user-model";
import { isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession } from 'mongoose';
import { EAuctionSortType, EAuctionStatus, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { Auction, IAuction, IAuctionInput } from "../models/auction-model";
import categoryService from "./category-service";
import forumService from "./forum-service";
import { Forum } from "../models/forum-model";
import { Transaction } from "../models/transaction-model";
import { Bid } from "../models/bid-model";

/**
 * Add an auction.
 * 
 * @param input
 * @returns 
 */
async function createAuction(currentUser: IAdmin, input: IAuctionInput): Promise<IAuction> {

  let sess: ClientSession | null = null;

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

    // Start session and mongo acid transaction
    sess = await startSession();

    await sess.withTransaction(async () => {

      await newAuction.save({
        session: sess
      });

      await forumService.createForum({
        auctionId: newAuction.id
      }, sess!);

    });

    return newAuction;
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
      if (conditions.get('status') === EAuctionStatus.ALL) {
        q.or([{status: EAuctionStatus.ACTIVE}, {status: EAuctionStatus.NOT_BEGUN}, {status: EAuctionStatus.CANCELLED}, {status: EAuctionStatus.ENDED}]);
      } else if (conditions.get('status') === EAuctionStatus.FRONT_VIEW) {
        q.or([{status: EAuctionStatus.ACTIVE}, {status: EAuctionStatus.NOT_BEGUN}]);
      } else {
        q.where({status: conditions.get('status')});
      }
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
async function getAuctionReport(auctionId: string | Schema.Types.ObjectId) {
  try {
    const calculateAgeGroup = (dob: Date) => {
      const age = Math.floor((Date.now() - dob.getTime()) / (1000 * 3600 * 24 * 365.25));
      if (age < 18) return '<18';
      if (age <= 30) return '18-30';
      if (age <= 50) return '31-50';
      return '51+';
    };
  
    const participantsAggregation = [
      { $match: { auctionId: new Schema.Types.ObjectId(auctionId.toString()) }},
      { $lookup: { from: 'users', localField: 'participants', foreignField: '_id', as: 'participantsDetails' }},
      { $unwind: '$participantsDetails' },
      { $addFields: { 'participantsDetails.ageGroup': { $function: { body: calculateAgeGroup.toString(), args: ['$participantsDetails.dob'], lang: 'js' }}}},
      { $group: { _id: { gender: '$participantsDetails.gender', ageGroup: '$participantsDetails.ageGroup' }, count: { $sum: 1 }}}
    ];
  
    const bidsAggregation = [
      { $match: { auctionId: new Schema.Types.ObjectId(auctionId.toString()) }},
      { $group: { _id: '$auctionId', highestBid: { $max: '$bidAmount' }, lowestBid: { $min: '$bidAmount' }}}
    ];
  
    const averagePriceAggregation = [
      { $match: { auctionId: new Schema.Types.ObjectId(auctionId.toString()) }},
      { $lookup: { from: 'items', localField: 'itemId', foreignField: '_id', as: 'itemDetails' }},
      { $unwind: '$itemDetails' },
      { $group: { _id: { breed: '$itemDetails.breedId', gender: '$itemDetails.gender' }, averagePrice: { $avg: '$amount' }}}
    ];
  
    const subtotalAggregation = [
      { $match: { auctionId: new Schema.Types.ObjectId(auctionId.toString()) }},
      { $lookup: { from: 'items', localField: 'itemId', foreignField: '_id', as: 'itemDetails' }},
      { $unwind: '$itemDetails' },
      { $group: { _id: { breed: '$itemDetails.breedId', gender: '$itemDetails.gender' }, subtotal: { $sum: '$amount' }}}
    ];
  
    const grandTotalAggregation = [
      { $match: { auctionId: new Schema.Types.ObjectId(auctionId.toString()) }},
      { $group: { _id: null, grandTotal: { $sum: '$amount' }}}
    ];
  
    const participants = await Forum.aggregate(participantsAggregation).exec();
    const bids = await Bid.aggregate(bidsAggregation).exec();
    const averagePrice = await Transaction.aggregate(averagePriceAggregation).exec();
    const subtotals = await Transaction.aggregate(subtotalAggregation).exec();
    const grandTotal = await Transaction.aggregate(grandTotalAggregation).exec();
  
    return {
      participants,
      bids,
      averagePrice,
      subtotals,
      grandTotal
    };
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