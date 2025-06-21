import { IAdmin, IAuctionApprover, ISeller } from "../models/user-model";
import { generateAuctionNumber, isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession, Types } from 'mongoose';
import { MAX_GEO_DISTANCE_AUCTION, EAuctionSortType, EAuctionStatus, EModels, EPublishedStatus, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER, languageType } from "../globals";
import { Auction, IAuction, IAuctionInput, IRequiredAttribute, IRequiredAttributeInput, RequiredAttribute } from "../models/auction-model";
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
    const currentCount = await Auction.count();
    newAuction.auctionNumber = generateAuctionNumber(currentCount);

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
 * Add a required attribute.
 * 
 * @param input
 * @returns 
 */
async function createRequiredAttribute(currentUser: IAdmin, input: IRequiredAttributeInput): Promise<IRequiredAttribute> {
  try {
    const newRequiredAttribute = new RequiredAttribute(input);

    return await newRequiredAttribute.save();

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
 * Get an auction by titleSlug.
 * 
 * @param titleSlug
 * @param lang
 * @param projection
 * @return
 */
async function getByTitleSlug(titleSlug: string, lang: languageType, projection?: any): Promise<IAuction | null> {
  try {
    let auction: IAuction | null = null;
    if (lang === 'en') {
      auction = await Auction.findOne({ 'titleSlug.en': titleSlug }, projection);
    } else {
      auction = await Auction.findOne({ 'titleSlug.tn': titleSlug }, projection);
    }
    return auction;
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

    // Set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Query builder
    const q = Auction.find({}, projection);

    // Populate 
    if (conditions.get('populateCreator')) {
      q.populate({
        path: 'creatorId',
        model: EModels.SELLER
      });
    }

    // Filters
    if (conditions.get('creatorId')) {
      q.where({ creatorId: conditions.get('creatorId') });
    }

    if (conditions.get('categoryId')) {
      q.where({ categoryId: conditions.get('categoryId') });
    }

    if (conditions.get('status')) {
      if (conditions.get('status') === EAuctionStatus.ALL) {
        q.or([
          { status: EAuctionStatus.ACTIVE },
          { status: EAuctionStatus.NOT_BEGUN },
          { status: EAuctionStatus.CANCELLED },
          { status: EAuctionStatus.ENDED }
        ]);
      } else if (conditions.get('status') === EAuctionStatus.FRONT_VIEW) {
        q.or([
          { status: EAuctionStatus.ACTIVE },
          { status: EAuctionStatus.NOT_BEGUN },
          { status: EAuctionStatus.ENDED }
        ]);
      } else {
        q.where({ status: conditions.get('status') });
      }
    }

    if (conditions.get('auctionCoordinates')) {
      q.where('auctionCoordinates').near({
        center: {
          type: 'Point',
          coordinates: conditions.get('auctionCoordinates')
        },
        maxDistance: MAX_GEO_DISTANCE_AUCTION,
        spherical: true
      });
    }

    // Filter by publishedStatus (if provided)
    if (conditions.get('publishedStatus')) {
      q.where({ publishedStatus: conditions.get('publishedStatus') });
    }

    // Range
    if (conditions.get('startDate') && conditions.get('endDate')) {
      q.and([
        { 'createdDate': { $gte: new Date(conditions.get('startDate')) } },
        { 'createdDate': { $lte: new Date(conditions.get('endDate')) } }
      ]);
    } else if (conditions.get('startDate')) {
      q.where({ 'createdDate': { $gte: new Date(conditions.get('startDate')) } });
    } else if (conditions.get('endDate')) {
      q.where({ 'createdDate': { $lte: new Date(conditions.get('endDate')) } });
    }

    // Sort
    if (conditions.get('sortBy')) {
      if (conditions.get('sortBy') === EAuctionSortType.DATE) {
        q.sort({ '_id': conditions.get('sortOrder') });
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
 * Get required attributes.
 * 
 * @returns 
 */
async function getRequiredAttributes(): Promise<IRequiredAttribute[]> {
  try {

    // Query builder
    const q = RequiredAttribute.find();

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
      { 
        $match: { 
          auctionId: new Types.ObjectId(auctionId.toString()), 
          isLivestock: true 
        } 
      },
      {
        $group: {
          _id: { breed: '$breed', gender: '$gender' },
          averagePrice: { $avg: { $ifNull: ['$currentBid', 0] } },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          breed: '$_id.breed',
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
          _id: { breed: '$breed', gender: '$gender' },
          subtotal: { $sum: { $ifNull: ['$currentBid', 0] } },
        },
      },
      {
        $lookup: {
          from: 'breeds',
          localField: '_id.breed',
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

/**
 * Publish an auction
 */
async function publishAuction(currentUser: IAuctionApprover, auctionId: string): Promise<IAuction> {
  try {
    const auction = await getById(auctionId);
    
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    if (auction.publishedStatus === EPublishedStatus.PUBLISHED) {
      throw new ForbiddenError('Auction is already published');
    }

    if (auction.publishedStatus === EPublishedStatus.REJECTED) {
      throw new ForbiddenError('Rejected auctions cannot be published without changes');
    }

    const updatedAuction = await Auction.findByIdAndUpdate(
      auctionId,
      { 
        publishedStatus: EPublishedStatus.PUBLISHED,
        publishedBy: currentUser._id,
        reasonForRejection: undefined
      },
      { new: true }
    ).select('-__v -globallyEligibleBidders');

    if (!updatedAuction) {
      throw new NotFoundError('Auction not found');
    }

    return updatedAuction;
  } catch (error) {
    throw error;
  }
}

/**
 * Unpublish an auction
 */
async function unpublishAuction(currentUser: ISeller, auctionId: string): Promise<IAuction> {
  try {
    const auction = await getById(auctionId);
    
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    if (auction.publishedStatus !== EPublishedStatus.PUBLISHED) {
      throw new ForbiddenError('Only published auctions can be unpublished');
    }

    if (auction.status === EAuctionStatus.ACTIVE) {
      throw new ForbiddenError('Active auctions cannot be unpublished');
    }

    const updatedAuction = await Auction.findByIdAndUpdate(
      auctionId,
      { 
        publishedStatus: EPublishedStatus.UNPUBLISHED,
        publishedBy: undefined,
        reasonForRejection: undefined
      },
      { new: true }
    ).select('-__v -globallyEligibleBidders');

    if (!updatedAuction) {
      throw new NotFoundError('Auction not found');
    }

    return updatedAuction;
  } catch (error) {
    throw error;
  }
}

/**
 * Updates the coordinates of an auction.
 */
async function updateAuctionCoordinates(auctionId: string,auctionCoordinates: { type: 'Point'; coordinates: [number, number] }): Promise<IAuction | null> {
  return Auction.findByIdAndUpdate(
    auctionId,
    { auctionCoordinates },
    { new: true }
  );
}


/**
 * Reject an auction
 */
async function rejectAuction(currentUser: IAuctionApprover, auctionId: string, reason: string): Promise<IAuction> {
  try {
    const auction = await getById(auctionId);
    
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    if (auction.publishedStatus === EPublishedStatus.PUBLISHED) {
      throw new ForbiddenError('Published auctions cannot be rejected');
    }

    if (!reason) {
      throw new ForbiddenError('Rejection reason is required');
    }

    const updatedAuction = await Auction.findByIdAndUpdate(
      auctionId,
      { 
        publishedStatus: EPublishedStatus.REJECTED,
        publishedBy: currentUser._id,
        reasonForRejection: reason,
        status: EAuctionStatus.CANCELLED
      },
      { new: true }
    ).select('-__v -globallyEligibleBidders');

    if (!updatedAuction) {
      throw new NotFoundError('Auction not found');
    }

    return updatedAuction;
  } catch (error) {
    throw error;
  }
}

/**
 * Updates the status of auctions based on their start and end times, considering their published status.
 *
 * - Only updates auctions that are `PUBLISHED`.
 * - Auctions that have started (`startTime <= now`) and are `PUBLISHED` are marked as `ACTIVE`.
 * - Auctions that have ended (`endTime <= now`) and are `PUBLISHED` are marked as `ENDED`.
 * - Auctions that are `NOT_BEGUN` but not yet `PUBLISHED` remain unchanged.
 *
 * @throws {Error} If an error occurs during the database update operation.
 * @return {Promise<void>} A promise that resolves once the updates are complete.
 */
async function trackAuctionStatus(): Promise<void> {
  try {
    await Promise.all([
      // Mark only PUBLISHED auctions as ENDED if their end time has passed
      Auction.updateMany(
        { 
          endTime: { $lte: new Date() }, 
          status: { $ne: EAuctionStatus.ENDED },
          publishedStatus: EPublishedStatus.PUBLISHED 
        },
        { $set: { status: EAuctionStatus.ENDED } }
      ),
      // Mark only PUBLISHED auctions as ACTIVE if their start time has passed and they are NOT_BEGUN
      Auction.updateMany(
        { 
          startTime: { $lte: new Date() }, 
          status: EAuctionStatus.NOT_BEGUN, 
          publishedStatus: EPublishedStatus.PUBLISHED
        },
        { $set: { status: EAuctionStatus.ACTIVE } }
      )
    ]);
  } catch (error) {
    throw error;
  }
}

// Export default
export default {
  createAuction,
  deleteAuction,
  getById,
  getByTitleSlug,
  getAuctions,
  searchAuctions,
  getAuctionReport,
  createRequiredAttribute,
  getRequiredAttributes,
  publishAuction,
  unpublishAuction,
  rejectAuction,
  trackAuctionStatus,
  updateAuctionCoordinates
} as const;