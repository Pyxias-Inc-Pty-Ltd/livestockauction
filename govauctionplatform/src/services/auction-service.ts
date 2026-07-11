import { Bidder, IBidder, IAdmin, IAuctionApprover, ISeller, User } from "../models/user-model";
import { generateAuctionNumber, isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession, Types } from 'mongoose';
import { MAX_GEO_DISTANCE_AUCTION, EAuctionSortType, EAuctionStatus, EItemStatus, EModels, EPublishedStatus, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER, languageType, SERVICE_URLS, KEY_SECRET, auctionInviteEmailTemplate, ETransactionType, EPaymentStatus } from "../globals";
import { Auction, IAuction, IAuctionInput, IRequiredAttribute, IRequiredAttributeInput, RequiredAttribute } from "../models/auction-model";
import * as axios from "axios";
import categoryService from "./category-service";
import forumService from "./forum-service";
import { Item } from "../models/item-model";
import { Transaction, ITransactionInput } from "../models/transaction-model";

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

    // Refund transactions grouped by status
    const refundMetrics = await Transaction.aggregate([
      {
        $match: {
          auctionId: new Types.ObjectId(auctionId.toString()),
          transactionType: ETransactionType.REFUND
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Reservation transactions grouped by status
    const reservationMetrics = await Transaction.aggregate([
      {
        $match: {
          auctionId: new Types.ObjectId(auctionId.toString()),
          transactionType: ETransactionType.RESERVATION
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' }
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
      sumOfEligibleBidders: sumOfEligibleBidders[0]?.totalEligibleBidders || 0,
      refundMetrics,
      reservationMetrics
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
async function unpublishAuction(currentUser: ISeller | IAuctionApprover, auctionId: string): Promise<IAuction> {
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
 * Update an auction's editable fields.
 * Only allowed when publishedStatus is UNPUBLISHED or REJECTED.
 * Only the creator (seller) may edit their own auction.
 */
async function updateAuction(currentUser: ISeller, auctionId: string, input: Partial<IAuctionInput>): Promise<IAuction> {
  try {
    const auction = await getById(auctionId);

    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    if (auction.creatorId.toString() !== (currentUser as any)._id.toString()) {
      throw new ForbiddenError('You do not have permission to edit this auction');
    }

    if (
      auction.publishedStatus !== EPublishedStatus.UNPUBLISHED &&
      auction.publishedStatus !== EPublishedStatus.REJECTED
    ) {
      throw new ForbiddenError('Only unpublished or rejected auctions can be edited');
    }

    if (input.startTime && !isBeforeStartDate(new Date(), new Date(input.startTime as any))) {
      throw new ForbiddenError('Start time must not come before the current time');
    }

    if (input.startTime && input.endTime && !isStartDateBeforeEndDate(new Date(input.startTime as any), new Date(input.endTime as any))) {
      throw new ForbiddenError('End time must not come before the start time');
    }

    // Normalize auctionCoordinates to always include type: 'Point'
    if (input.auctionCoordinates) {
      input.auctionCoordinates = {
        type: 'Point',
        coordinates: input.auctionCoordinates.coordinates,
      };
    }

    // If auction was REJECTED, reset publishedStatus back to UNPUBLISHED on edit
    const publishedStatusReset = auction.publishedStatus === EPublishedStatus.REJECTED
      ? { publishedStatus: EPublishedStatus.UNPUBLISHED, reasonForRejection: undefined }
      : {};

    // Reset execution status to NOT_BEGUN when dates are updated — the scheduler
    // will re-evaluate once the auction is published
    const statusReset = (input.startTime || input.endTime)
      ? { status: EAuctionStatus.NOT_BEGUN }
      : {};

    // When disabling the registration fee, remove the stale fee amount so it
    // cannot be referenced in downstream payment/transaction workflows.
    const unsetFields: Record<string, ''> = {};
    if (input.hasRegistrationFee === false) {
      delete (input as any).registrationFee;
      unsetFields.registrationFee = '';
    }

    const updateDoc: Record<string, any> = {
      $set: { ...input, ...publishedStatusReset, ...statusReset },
    };
    if (Object.keys(unsetFields).length > 0) {
      updateDoc.$unset = unsetFields;
    }

    const updatedAuction = await Auction.findByIdAndUpdate(
      auctionId,
      updateDoc,
      { new: true }
    ).select('-__v -globallyEligibleBidders');

    if (!updatedAuction) {
      throw new NotFoundError('Auction not found');
    }

    // Cascade time changes to all lots in this auction
    if (input.startTime || input.endTime) {
      const lotTimeUpdate: Record<string, any> = {};
      if (input.startTime) lotTimeUpdate.startTime = input.startTime;
      if (input.endTime)   lotTimeUpdate.endTime   = input.endTime;
      await Item.updateMany({ auctionId }, lotTimeUpdate);
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
 * Uses bulkWrite (no MongoDB session/transaction) so it works on both standalone and replica-set deployments.
 *
 * - Only updates auctions that are `PUBLISHED`.
 * - Auctions that have started (`startTime <= now`) and are `PUBLISHED` are marked as `ACTIVE`.
 * - Auctions that have ended (`endTime <= now`) and are `PUBLISHED` are marked as `ENDED`.
 * - Cascades: closes all ACTIVE/NOT_BEGUN lots that belong to auctions being ended.
 *
 * @throws {Error} If an error occurs during the database update operation.
 * @return {Promise<void>} A promise that resolves once the updates are complete.
 */
async function trackAuctionStatus(): Promise<void> {
  try {
    const now = new Date();

    const [auctionsToEnd, auctionsToActivate] = await Promise.all([
      Auction.find(
        { endTime: { $lte: now }, status: { $ne: EAuctionStatus.ENDED }, publishedStatus: EPublishedStatus.PUBLISHED },
        { _id: 1 },
      ),
      Auction.find(
        { startTime: { $lte: now }, status: EAuctionStatus.NOT_BEGUN, publishedStatus: EPublishedStatus.PUBLISHED },
        { _id: 1 },
      ),
    ]);

    const bulkOps: any[] = [];

    auctionsToEnd.forEach(auction => {
      bulkOps.push({
        updateOne: { filter: { _id: auction._id }, update: { $set: { status: EAuctionStatus.ENDED } } },
      });
    });

    auctionsToActivate.forEach(auction => {
      bulkOps.push({
        updateOne: { filter: { _id: auction._id }, update: { $set: { status: EAuctionStatus.ACTIVE } } },
      });
    });

    if (bulkOps.length > 0) {
      await Auction.bulkWrite(bulkOps);
    }

    // Cascade: close all lots belonging to auctions that just ended.
    if (auctionsToEnd.length > 0) {
      const endedAuctionIds = auctionsToEnd.map(a => a._id);
      await Item.updateMany(
        {
          auctionId: { $in: endedAuctionIds },
          status: { $in: [EItemStatus.ACTIVE, EItemStatus.NOT_BEGUN] },
        },
        { $set: { status: EItemStatus.ENDED } },
      );
    }
  } catch (error) {
    console.error('Error in trackAuctionStatus:', error);
    throw error;
  }
}

/**
 * Set the current active lot for an auction (seller only).
 * No runValidators — auction has a 2dsphere index.
 */
async function setCurrentLot(seller: ISeller, auctionId: string, lotId: string): Promise<void> {
  if (!isMongoId(auctionId) || !isMongoId(lotId)) {
    throw new ForbiddenError('Invalid auctionId or lotId');
  }
  const auction = await Auction.findById(auctionId);
  if (!auction) throw new NotFoundError('Auction not found');
  if (auction.creatorId.toString() !== seller._id.toString()) {
    throw new ForbiddenError('You do not own this auction');
  }
  await Auction.findByIdAndUpdate(auctionId, { currentLotId: lotId });
}

/**
 * Get the current active lot for an auction (public).
 */
async function getCurrentLot(auctionId: string): Promise<{ currentLotId: string | null }> {
  if (!isMongoId(auctionId)) throw new ForbiddenError('Invalid auctionId');
  const auction = await Auction.findById(auctionId).select('currentLotId');
  if (!auction) throw new NotFoundError('Auction not found');
  return { currentLotId: auction.currentLotId?.toString() ?? null };
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
  updateAuction,
  updateAuctionCoordinates,
  addInvitedBidders,
  removeInvitedBidder,
  revokeInvitedBidder,
  getInvitedBidders,
  inviteByEmail,
  setCurrentLot,
  getCurrentLot,
} as const;

// ── Invited bidder helpers ─────────────────────────────────────────────────

/**
 * Add bidders to the auction's invitedBidders list.
 */
async function addInvitedBidders(auctionId: string, bidderIds: string[]): Promise<IAuction> {
  const auction = await getById(auctionId);
  if (!auction) throw new NotFoundError('Auction not found');

  const existing = new Set(auction.invitedBidders.map(String));
  for (const id of bidderIds) {
    if (!existing.has(String(id))) {
      auction.invitedBidders.push(id as any);
    }
  }
  return await auction.save();
}

/**
 * Remove a bidder from the auction's invitedBidders list.
 */
async function removeInvitedBidder(auctionId: string, bidderId: string): Promise<IAuction> {
  const auction = await getById(auctionId);
  if (!auction) throw new NotFoundError('Auction not found');

  auction.invitedBidders = auction.invitedBidders.filter(
    (id: any) => id.toString() !== bidderId
  );
  return await auction.save();
}

/**
 * Revoke an invited bidder from a NOT_BEGUN auction.
 * - Guards: only allowed when auction.status === NOT_BEGUN
 * - Removes bidder from auction.invitedBidders
 * - Pulls bidder from item.eligibleBidders on all items in the auction
 * - Creates PENDING REFUND transactions for any COMPLETED RESERVATION transactions
 */
async function revokeInvitedBidder(auctionId: string, bidderId: string): Promise<IAuction> {
  const auction = await getById(auctionId);
  if (!auction) throw new NotFoundError('Auction not found');

  if (auction.status !== EAuctionStatus.NOT_BEGUN) {
    throw new ForbiddenError('Bidders can only be revoked when the auction has not yet begun');
  }

  // Remove from invitedBidders
  auction.invitedBidders = auction.invitedBidders.filter(
    (id: any) => id.toString() !== bidderId
  );
  const savedAuction = await auction.save();

  // Cascade: remove from eligibleBidders on all items
  await Item.updateMany({ auctionId }, { $pull: { eligibleBidders: bidderId } });

  // Create REFUND transactions for any COMPLETED RESERVATION transactions
  const reservations = await Transaction.find({
    auctionId,
    buyerId: bidderId,
    transactionType: ETransactionType.RESERVATION,
    status: EPaymentStatus.COMPLETED,
  });

  const callbackUrl = `${SERVICE_URLS.auctionsGovServerBaseURI}/open/completeRefund`;

  for (const reservation of reservations) {
    const existingRefund = await Transaction.findOne({
      relatedTransaction: reservation._id,
      transactionType: ETransactionType.REFUND,
    });

    if (existingRefund) continue;

    const refundInput: ITransactionInput = {
      auctionId: reservation.auctionId,
      itemId: reservation.itemId,
      buyerId: reservation.buyerId,
      sellerId: reservation.sellerId,
      currency: reservation.currency,
      amount: reservation.amount,
      transactionType: ETransactionType.REFUND,
      relatedTransaction: reservation._id,
      metadata: {},
    };

    const refundTx = new Transaction(refundInput);
    refundTx.status = EPaymentStatus.PENDING;

    const resMeta = reservation.metadata as Map<string, string>;
    const originalPayRequestId = resMeta.get('PAY_REQUEST_ID');
    if (originalPayRequestId) {
      (refundTx.metadata as Map<string, string>).set('originalPAY_REQUEST_ID', originalPayRequestId);
    }

    const transactionId = resMeta.get('TRANSACTION_ID');
    if (!transactionId) {
      (refundTx.metadata as Map<string, string>).set('needsManualRefund', 'true');
    }

    await refundTx.save();

    // Enqueue via the queue service for async PayHost SOAP processing with retry.
    // PayHost identifies the original transaction by MerchantOrderId (our MongoDB _id,
    // which was sent as REFERENCE in the original PayWeb3 call).
    if (transactionId) {
      try {
        // Resolve per-seller PayGate credentials; fall back to global if seller has none.
        let paygateId: string | undefined;
        let payhostEncryptionKey: string | undefined;
        try {
          const seller = await User.findById(reservation.sellerId, { paygateId: 1, payhostEncryptionKey: 1 }) as ISeller | null;
          paygateId = seller?.paygateId;
          payhostEncryptionKey = seller?.payhostEncryptionKey || undefined;
        } catch {}

        const amountCents = Math.round(refundTx.amount * 100);
        await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/refundQueue/add-job`, {
          merchantOrderId: String(reservation._id),
          amountCents,
          reference: String(refundTx._id),
          callbackUrl,
          ...(paygateId && { paygateId }),
          ...(payhostEncryptionKey && { payhostEncryptionKey }),
        }, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": KEY_SECRET
          }
        });
        console.info(`[auction-service] Enqueued revoke refund job for ${refundTx._id} (reservation ${reservation._id})`);
      } catch (err) {
        console.error(`[auction-service] Failed to enqueue revoke refund for ${refundTx._id} — flagging for manual refund:`, err);
        (refundTx.metadata as Map<string, string>).set('needsManualRefund', 'true');
        await refundTx.save();
      }
    }
  }

  return savedAuction;
}

/**
 * Get invited bidders with full details (name, email, keeperId).
 */
async function getInvitedBidders(auctionId: string): Promise<IBidder[]> {
  const auction = await getById(auctionId, { invitedBidders: 1 });
  if (!auction) throw new NotFoundError('Auction not found');

  if (!auction.invitedBidders || auction.invitedBidders.length === 0) return [];

  return await Bidder.find({ _id: { $in: auction.invitedBidders } }).select('-__v');
}

/**
 * Invite a bidder by email address.
 * If an account already exists for that email, adds them to invitedBidders directly.
 * Otherwise stores the email in pendingInviteEmails and sends an invitation email.
 * The pending invite is resolved automatically when the user registers (see user-service.ts).
 */
async function inviteByEmail(auctionId: string, email: string): Promise<{ resolved: boolean }> {
  const normalizedEmail = email.toLowerCase().trim();

  const auction = await getById(auctionId);
  if (!auction) throw new NotFoundError('Auction not found');

  // If a bidder account already exists for this email, add them directly
  const existingBidder = await Bidder.findOne({ email: normalizedEmail });
  if (existingBidder) {
    await addInvitedBidders(auctionId, [existingBidder.id.toString()]);
    return { resolved: true };
  }

  // No account yet — store pending invite if not already present
  if (!auction.pendingInviteEmails.includes(normalizedEmail)) {
    auction.pendingInviteEmails.push(normalizedEmail);
    await auction.save();
  }

  // Queue invitation email
  await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
    data: {
      subject: `You've been invited to bid: ${auction.title.en}`,
      email: normalizedEmail,
      message: auctionInviteEmailTemplate
        .replace('[AuctionTitle]', auction.title.en)
        .replace('[RegisterLink]', `${SERVICE_URLS.clientURI}/register`),
    },
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY_SECRET,
    },
  });

  return { resolved: false };
}