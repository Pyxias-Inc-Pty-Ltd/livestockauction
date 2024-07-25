import { IAdmin } from "../models/user-model";
import { isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession, Types } from 'mongoose';
import { EAuctionSortType, EAuctionStatus, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { Auction, IAuction, IAuctionInput } from "../models/auction-model";
import categoryService from "./category-service";
import forumService from "./forum-service";
import { Item } from "../models/item-model";

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
        q.or([{status: EAuctionStatus.ACTIVE}, {status: EAuctionStatus.NOT_BEGUN}, {status: EAuctionStatus.ENDED}]);
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
    // Number of Participants (by gender and age group)
    const participantsByGenderAge = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()) } },
      { $unwind: '$eligibleBidders' },
      {
        $addFields: {
          eligibleBidderObjectId: { $toObjectId: '$eligibleBidders' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'eligibleBidderObjectId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $group: {
          _id: '$user._id',
          gender: { $first: '$user.gender' },
          age: { $first: { $subtract: [{ $year: new Date() }, { $year: '$user.dob' }] } }
        }
      },
      {
        $group: {
          _id: {
            gender: '$gender',
            ageGroup: {
              $cond: {
                if: { $lt: ['$age', 18] },
                then: 'Under 18',
                else: {
                  $cond: {
                    if: { $and: [{ $gte: ['$age', 18] }, { $lte: ['$age', 24] }] },
                    then: '18-24',
                    else: {
                      $cond: {
                        if: { $and: [{ $gte: ['$age', 25] }, { $lte: ['$age', 34] }] },
                        then: '25-34',
                        else: {
                          $cond: {
                            if: { $and: [{ $gte: ['$age', 35] }, { $lte: ['$age', 44] }] },
                            then: '35-44',
                            else: '45 and Over'
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          count: { $sum: 1 },
        },
      }
    ]);  

    // Highest and Lowest Bids
    const highestLowestBids = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()) } },
      {
        $lookup: {
          from: 'bids',
          localField: '_id',
          foreignField: 'itemId',
          as: 'bids',
        },
      },
      { $unwind: '$bids' },
      {
        $group: {
          _id: null,
          highestBid: { $max: '$bids.bidAmount' },
          lowestBid: { $min: '$bids.bidAmount' },
        },
      }
    ]);

    // Average Price (by breed and sex)
    const averagePriceByBreedSex = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()), isLivestock: true } },
      {
        $group: {
          _id: { breedId: '$breedId', gender: '$gender' },
          averagePrice: { $avg: { $ifNull: ['$currentBid', 0] } },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'breeds',
          localField: '_id.breedId',
          foreignField: '_id',
          as: 'breed',
        },
      },
      { $unwind: '$breed' },
      {
        $project: {
          _id: 0,
          breed: '$breed.name',
          gender: '$_id.gender',
          averagePrice: 1,
          count: 1,
        },
      }
    ]);

    // Subtotals Generated (by breed and sex)
    const subtotalsByBreedSex = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()), isLivestock: true } },
      {
        $group: {
          _id: { breedId: '$breedId', gender: '$gender' },
          subtotal: { $sum: { $ifNull: ['$currentBid', 0] } },
        },
      },
      {
        $lookup: {
          from: 'breeds',
          localField: '_id.breedId',
          foreignField: '_id',
          as: 'breed',
        },
      },
      { $unwind: '$breed' },
      {
        $project: {
          _id: 0,
          breed: '$breed.name',
          gender: '$_id.gender',
          subtotal: 1,
        },
      }
    ]);

    // Items Purchased vs. Not Purchased
    const itemsPurchasedVsNotPurchased = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()), status: 'ENDED' } },
      {
        $group: {
          _id: {
            purchased: { $cond: [{ $ifNull: ['$winningBidder', false] }, true, false] }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          purchased: '$_id.purchased',
          count: 1
        }
      }
    ]);

    // Grand Total of Money Generated
    const grandTotal = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()) } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$currentBid', 0] } },
        },
      }
    ]);

    // Sum of elibigble bidders
    const sumOfEligibleBidders = await Item.aggregate([
      { $match: { auctionId: new Types.ObjectId(auctionId.toString()) } },
      {
        $group: {
          _id: null,
          totalEligibleBidders: { $sum: { $size: "$eligibleBidders" } }
        }
      },
      {
        $project: {
          _id: 0,
          totalEligibleBidders: 1
        }
      }
    ]);

    return {
      participantsByGenderAge,
      highestLowestBids,
      averagePriceByBreedSex,
      subtotalsByBreedSex,
      itemsPurchasedVsNotPurchased,
      grandTotal: grandTotal[0]?.total || 0,
      sumOfEligibleBidders: sumOfEligibleBidders[0]?.totalEligibleBidders || 0
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