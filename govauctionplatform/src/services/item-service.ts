import { Bidder, IAdmin, IBidder } from "../models/user-model";
import { IEligibleBidder, IItem, IItemInput, Item } from "../models/item-model";
import { formatBAITSAnimalEID, getAnimalBreedById, getAnimalByEID, isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, InternalServerError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { Schema } from 'mongoose';
import { EGenderType, EItemSortType, EItemStatus, ESortOrderType, languageType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import auctionService from "./auction-service";
import { ClientSession, startSession } from 'mongoose';
import bidService from "./bid-service";
import categoryService from "./category-service";

/**
 * Add an item.
 * 
 * @param input
 * @return 
 */
async function createItem(currentUser: IAdmin, input: IItemInput): Promise<IItem> {

  let sess: ClientSession | null = null;

  try {
    const newItem = new Item(input);

    if (newItem.metadata.isLivestock) {
      const formattedEID = formatBAITSAnimalEID(input.metadata.animalEID!);
      const animalData = await getAnimalByEID(formattedEID);
      const breedData = await getAnimalBreedById(animalData.AnimalBreedID);

      newItem.metadata.dob = new Date(animalData.DateOfBirth);
      newItem.metadata.gender = animalData.Gender === "Female" ? EGenderType.FEMALE : EGenderType.MALE;
      newItem.metadata.breed = breedData.AnimalBreedDescription;
      newItem.metadata.baitsDump = JSON.stringify(animalData);
    }

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
    newItem.metadata.categoryId = auction.categoryId;

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
 * @return 
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
 * @return 
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
 * @return 
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
 * @return 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IItem | null> {
  try {
    if (isMongoId(id.toString())) {
      const item = await Item.findById(id, projection)
        .populate({
          path: "formId"
        });
      // if (item?.metadata.categoryId) {
      //   const categoryId = await categoryService.getById(item.metadata.categoryId, { name: 1 });
      //   if (!categoryId) {
      //     throw new NotFoundError('Category not found');
      //   }
      //   item.metadata.categoryId = categoryId.name;
      // }
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
 * Get an item by titleSlug.
 * 
 * @param titleSlug
 * @param lang
 * @param projection
 * @return
 */
async function getByTitleSlug(titleSlug: string, lang: languageType, projection?: any): Promise<IItem | null> {
  try {
    let item: IItem | null = null;
    if (lang === 'en') {
      item = await Item.findOne({ 'titleSlug.en': titleSlug }, projection)
      .populate({
        path: "formId"
      });
    } else {
      item = await Item.findOne({ 'titleSlug.tn': titleSlug }, projection)
      .populate({
        path: "formId"
      });
    }
    // if (item?.metadata.categoryId) {
    //   const categoryId = await categoryService.getById(item.metadata.categoryId, { name: 1 });
    //   if (!categoryId) {
    //     throw new NotFoundError('Category not found');
    //   }
    //   item.metadata.categoryId = categoryId.name;
    // }
    return item;
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Set the winning bidder of a lot (admin override).
 *
 * This endpoint is used when an admin needs to manually confirm or override
 * the winner — for example when the automatic selection is disputed.
 *
 * Enforcements:
 *  - The lot must be in ENDED status.
 *  - The supplied bidder must be the holder of the highest non-retracted bid.
 *    This prevents an admin from awarding the lot to an arbitrary participant.
 *
 * For the automatic (non-override) path, see `autoSelectWinner`.
 *
 * @param input.itemId   The lot to update.
 * @param input.bidderId The bidder who should be declared the winner.
 */
async function setWinningBidder(
  input: { itemId: string | Schema.Types.ObjectId; bidderId: string | Schema.Types.ObjectId },
): Promise<IItem> {
  const item = await getById(input.itemId);
  if (!item) throw new NotFoundError('Item not found');

  if (item.status !== EItemStatus.ENDED) {
    throw new ForbiddenError('Winner can only be set after the lot has ended');
  }

  if (item.eligibleBidders.indexOf(input.bidderId.toString()) === -1) {
    throw new ForbiddenError('Bidder must be in the list of eligible bidders');
  }

  const winningBid = await bidService.getWinningBid(item.id.toString());
  if (!winningBid) {
    throw new InternalServerError('No bids found for this lot');
  }

  if (winningBid.userId.toString() !== input.bidderId.toString()) {
    throw new ForbiddenError(
      'The supplied bidder did not place the highest bid — ' +
      'winner must be the holder of the leading bid',
    );
  }

  item.winningBidder = input.bidderId as any;
  return await item.save();
}

/**
 * Automatically select the winner of a lot based on the highest bid.
 *
 * Called by `trackItemStatus` immediately after a lot transitions to ENDED
 * (and after sealed bids have been decrypted).  Idempotent — if a winner is
 * already set, the function returns the existing item unchanged.
 *
 * Lots with no bids remain without a winner; the admin can set one manually
 * or declare a no-sale.
 *
 * @param itemId  The lot that just ended.
 * @returns       The updated item, or null if the item was not found.
 */
async function autoSelectWinner(itemId: string): Promise<IItem | null> {
  const item = await getById(itemId);
  if (!item) return null;

  // Already assigned (e.g. admin set it manually before cron ran, or a
  // buyout triggered winner assignment inside the bid transaction).
  if (item.winningBidder) return item;

  const winningBid = await bidService.getWinningBid(itemId);
  if (!winningBid) {
    // No bids placed — lot goes unsold, no winner to assign.
    return item;
  }

  // Reserve price check: if the highest bid falls below the reserve, the lot
  // goes unsold.  We still record the highest bidder for admin visibility, but
  // flag the item so the auctioneer knows the reserve was not met.
  if (item.reservePrice && winningBid.bidAmount < item.reservePrice) {
    console.warn(
      `[item-service] Item ${itemId} reserve price not met ` +
      `(highest bid: ${winningBid.bidAmount}, reserve: ${item.reservePrice}). ` +
      `No winner assigned — admin action required.`,
    );
    // Do not set winningBidder — leave it unset so admin can decide.
    return item;
  }

  item.winningBidder = winningBid.userId as any;
  return await item.save();
}

async function updateItemWithBid(item: IItem, newBidAmount: number, session: ClientSession): Promise<boolean> {
  // Use an aggregation-pipeline update so $max is evaluated atomically server-side.
  // This guarantees a lower concurrent bid can never overwrite a higher one, even if
  // two writes land at exactly the same millisecond.
  // The version field is still incremented so callers can detect conflicts.
  const result = await Item.updateOne(
    { _id: item._id, version: item.version },
    [
      {
        $set: {
          currentBid: { $max: ['$currentBid', newBidAmount] },
          version: { $add: ['$version', 1] },
        },
      },
    ],
    { session },
  );

  return result.modifiedCount === 1;
}

/**
 * Get items won by a bidder.
 * 
 * @param currentUser
 * @param conditions
 * @param projection
 * @return 
 */
async function getItemsWon(currentUser: IBidder, conditions: Map<string, any>, projection?: any): Promise<IItem[]> {
  // Ensure the winningBidder condition is set
  conditions.set('status', EItemStatus.ENDED);
  conditions.set('winningBidder', currentUser.id);
  
  // Call getItems with the modified conditions
  return await getItems(conditions, projection);
}

/**
 * Get items.
 * 
 * @param conditions
 * @param projection
 * @return
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

    if (conditions.get('winningBidder')) {
      q.where({winningBidder: conditions.get('winningBidder')});
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

/**
 * Get eligible bidders.
 * 
 * @param itemId
 * @return
 */
async function getEligibleBidders(itemId: string | Schema.Types.ObjectId): Promise<IEligibleBidder[]> {
  try {
    const item = await getById(itemId);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    const auction = await auctionService.getById(item.auctionId, { participantsWithBiddingNumbers: 1 });

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    const eligibleBidders = await Bidder.find({ _id: { $in: item.eligibleBidders } });

    if (eligibleBidders.length > 0) {
      // Filter bidders who have bidding numbers in the auction
      return eligibleBidders
        .filter((bidder: IBidder) => 
          auction.participantsWithBiddingNumbers.some(
            (participant: string) => participant.split(':')[0] === bidder._id.toString()
          )
        )
        .map((bidder: IBidder) => {
          const participantInfo = auction.participantsWithBiddingNumbers.find(
            (p: string) => p.split(':')[0] === bidder._id.toString()
          );

          return {
            firstName: bidder.firstName,
            lastName: bidder.lastName,
            name: bidder.name,
            keeperId: bidder.keeperId || '',
            bidderNumber: participantInfo ? participantInfo.split(':')[1] : null
          };
        });
    } else {
      return [];
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Updates the status of items based on their start and end times.
 * Updates each document individually to trigger Mongoose post-save middleware
 * within a MongoDB transaction for atomicity.
 *
 * - Marks items as `ENDED` if their `endTime` has passed.
 * - Marks items as `ACTIVE` if their `startTime` has passed and they are still `NOT_BEGUN`.
 *
 * @throws {Error} If an error occurs during the database update operation.
 * @return {Promise<void>} A promise that resolves once the updates are complete.
 */
async function trackItemStatus(): Promise<void> {
  const sess = await startSession();
  // Collected inside the transaction; consumed outside after commit.
  const sealedItemIdsJustEnded: string[] = [];

  try {
    await sess.withTransaction(async () => {
      const [itemsToEnd, itemsToActivate] = await Promise.all([
        Item.find({
          endTime: { $lte: new Date() },
          status: { $ne: EItemStatus.ENDED }
        }).session(sess),
        Item.find({
          startTime: { $lte: new Date() },
          status: EItemStatus.NOT_BEGUN
        }).session(sess)
      ]);

      const itemsToUpdate = new Map<string, { item: any; newStatus: EItemStatus }>();

      itemsToEnd.forEach(item => {
        itemsToUpdate.set(item._id.toString(), {
          item,
          newStatus: EItemStatus.ENDED
        });
        // Track sealed items that are about to close so we can decrypt their
        // bids after the transaction commits.
        if (item.isClosedBidding) {
          sealedItemIdsJustEnded.push(item._id.toString());
        }
      });

      itemsToActivate.forEach(item => {
        itemsToUpdate.set(item._id.toString(), {
          item,
          newStatus: EItemStatus.ACTIVE
        });
      });

      // Update each document individually
      const updatePromises = Array.from(itemsToUpdate.values()).map(({ item, newStatus }) => {
        item.status = newStatus;
        return item.save({ session: sess });
      });

      await Promise.all(updatePromises);
    });

    // After the transaction commits: decrypt sealed bids for items that just
    // ended.  This unblocks winner determination and post-auction reporting.
    // Each item is processed independently — one failure doesn't block others.
    if (sealedItemIdsJustEnded.length > 0) {
      await Promise.all(
        sealedItemIdsJustEnded.map((itemId) =>
          bidService.decryptSealedBids(itemId).catch((err: Error) =>
            console.error(
              `[item-service] Failed to decrypt sealed bids for item ${itemId}: ${err.message}`,
            ),
          ),
        ),
      );
    }

    // Auto-select the winner for every lot that just ended (all modes).
    // For sealed lots this runs after decryption so getWinningBid sees real amounts.
    // Collect all items that transitioned to ENDED in this tick.
    const allEndedItemIds: string[] = [];
    // itemsToEnd was populated inside the transaction; collect via a targeted query.
    const justEndedItems = await Item.find(
      { endTime: { $lte: new Date() }, status: EItemStatus.ENDED, winningBidder: { $exists: false } },
      { _id: 1 },
    );
    justEndedItems.forEach((item) => allEndedItemIds.push(item._id.toString()));

    if (allEndedItemIds.length > 0) {
      await Promise.all(
        allEndedItemIds.map((itemId) =>
          autoSelectWinner(itemId).catch((err: Error) =>
            console.error(
              `[item-service] autoSelectWinner failed for item ${itemId}: ${err.message}`,
            ),
          ),
        ),
      );
    }
  } catch (error) {
    console.error('Error in trackItemStatus transaction:', error);
    throw error;
  } finally {
    await sess.endSession();
  }
}

/**
 * Return ENDED items that have a winner set and still have COMPLETED RESERVATION
 * transactions for non-winners that have not yet been refunded.
 * Used by the open-router to trigger non-winner refunds after trackItemStatus.
 */
async function getItemsWithWinnerForRefund(): Promise<IItem[]> {
  return await Item.find(
    { status: EItemStatus.ENDED, winningBidder: { $exists: true, $ne: null } },
    { _id: 1, winningBidder: 1 }
  );
}

// Export default
export default {
  createItem,
  setWinningBidder,
  autoSelectWinner,
  updateItemWithBid,
  getManualBidAmount,
  setNewBidAmountManually,
  getEligibleBidders,
  deleteItem,
  trackItemStatus,
  getByTitleSlug,
  getById,
  getItems,
  getItemsWon,
  getItemsWithWinnerForRefund
} as const;