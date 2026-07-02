import { Bidder, IAdmin, IBidder, ISeller, IUser } from "../models/user-model";
import { IEligibleBidder, IItem, IItemInput, Item } from "../models/item-model";
import { Bid } from "../models/bid-model";
import { Auction } from "../models/auction-model";
import { formatBAITSAnimalEID, getAnimalBreedById, getAnimalByEID, isBeforeStartDate, isStartDateBeforeEndDate } from "../shared/functions";
import { ForbiddenError, InternalServerError, NotFoundError, BadRequestError } from "../shared/errors";
import { isMongoId } from "validator";
import { Schema } from 'mongoose';
import { EAuctionStatus, EGenderType, EItemSortType, EItemStatus, ESortOrderType, ESocketEventCode, EUserType, languageType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { socketEmitter } from "../shared/socket-emitter";
import auctionService from "./auction-service";
import transactionService from "./transaction-service";
import { ClientSession, startSession } from 'mongoose';
import bidService from "./bid-service";
import categoryService from "./category-service";
import { scheduleCloseLot } from "../queues/close-lot-queue";
import { acquireBidLockWithWait, releaseBidLock } from "../shared/bid-lock";

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

    // Schedule the close-lot job to fire at exactly endTime.
    // Fire-and-forget: a failure here is non-critical — the cron safety net
    // (trackItemStatus) will still close the lot within ~60 s of endTime.
    scheduleCloseLot(newItem._id.toString(), newItem.endTime).catch((err: Error) =>
      console.error(`[item-service] Failed to schedule close-lot for ${newItem._id}: ${err.message}`),
    );

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
 * Cancel a lot. Only allowed when status is NOT_BEGUN or ACTIVE.
 * Seller must own the lot; admin needs LOT_MANAGE permission (checked in route).
 * Sets status to CANCELLED, records audit trail, and initiates refunds for all
 * completed reservation transactions on the lot.
 *
 * @param currentUser
 * @param itemId
 * @param reason  Why the lot is being cancelled (audit trail).
 */
async function cancelItem(currentUser: IUser, itemId: string, reason: string): Promise<IItem> {
  const item = await getById(itemId);
  if (!item) {
    throw new NotFoundError('Item not found');
  }

  // Only NOT_BEGUN and ACTIVE lots can be cancelled.
  if (item.status !== EItemStatus.NOT_BEGUN && item.status !== EItemStatus.ACTIVE) {
    throw new ForbiddenError('Only lots that have not ended can be cancelled');
  }

  // Seller must own the lot; admin is allowed via LOT_MANAGE (checked in route).
  if (currentUser.userType === EUserType.SELLER) {
    if ((item.sellerId as Schema.Types.ObjectId).toString() !== currentUser.id.toString()) {
      throw new ForbiddenError('You do not have permission to cancel this lot');
    }
  }

  item.status = EItemStatus.CANCELLED;
  item.cancelledBy = currentUser.id as any;
  item.cancelReason = reason;
  item.cancelledAt = new Date();

  const saved = await item.save();

  // Initiate refunds for all completed reservations (fire-and-forget the async
  // queue processing — the function logs its own errors).
  transactionService.initiateCancellationRefunds(itemId).catch((err: Error) =>
    console.error(`[item-service] Cancellation refunds failed for item ${itemId}: ${err.message}`),
  );

  // Notify connected clients in the lot room.
  socketEmitter
    .to(`${itemId}-bid`)
    .emit(ESocketEventCode.LOT_CANCELLED, {
      itemId,
      reason,
      cancelledAt: item.cancelledAt.toISOString(),
    });

  return saved;
}

/**
 * Update an item. Only allowed when status is NOT_BEGUN and caller is the seller.
 */
async function updateItem(currentUser: ISeller, itemId: string, input: Partial<IItemInput>): Promise<IItem> {
  try {
    const item = await getById(itemId);

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (item.sellerId.toString() !== currentUser.id.toString()) {
      throw new ForbiddenError('You do not have permission to update this item');
    }

    if (item.status !== EItemStatus.NOT_BEGUN) {
      throw new ForbiddenError('Can only edit a lot that has not yet begun');
    }

    if (input.startTime && !isBeforeStartDate(new Date(), new Date(input.startTime))) {
      throw new ForbiddenError('Start time must not come before the current time');
    }

    if (input.startTime && input.endTime && !isStartDateBeforeEndDate(new Date(input.startTime), new Date(input.endTime))) {
      throw new ForbiddenError('End time must not come before the start time');
    }

    const updatableFields: Array<keyof IItemInput> = [
      'title', 'description', 'terms', 'gallery',
      'startingBid', 'reservePrice', 'buyoutPrice',
      'startTime', 'endTime', 'metadata',
    ];

    for (const field of updatableFields) {
      if (input[field] !== undefined) {
        (item as any)[field] = input[field];
      }
    }

    const saved = await item.save();

    // Reschedule close-lot if endTime was updated.
    if (input.endTime) {
      scheduleCloseLot(saved._id.toString(), saved.endTime).catch((err: Error) =>
        console.error(`[item-service] Failed to reschedule close-lot for ${saved._id}: ${err.message}`),
      );
    }

    return saved;
  } catch (error) {
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

    // Guard: the call price must be strictly higher than the highest accepted bid.
    const highestBid = await Bid.findOne({ itemId: input.itemId, isRetracted: false })
      .sort({ bidAmount: -1 })
      .select('bidAmount')
      .lean();
    const maxBid = highestBid?.bidAmount ?? 0;
    if (input.amount <= maxBid) {
      throw new BadRequestError(`Call price must be higher than the highest bid (${maxBid})`);
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

  // Manual-bid (livestream) lots are seller-controlled — allow awarding
  // the winner as soon as the seller decides bidding is over, without
  // waiting for the cron to transition status to ENDED.
  if (!item.isBidIncrementedManually && item.status !== EItemStatus.ENDED) {
    throw new ForbiddenError('Winner can only be set after the lot has ended');
  }

  if (item.eligibleBidders.indexOf(input.bidderId.toString()) === -1) {
    throw new ForbiddenError('Bidder must be in the list of eligible bidders');
  }

  // Acquire the per-item bid lock before reading the winning bid.
  //
  // Race condition without this lock:
  //   1. setWinningBidder reads winningBid → A at $500
  //   2. Bid B at $600 is saved by a concurrent bid-worker transaction
  //   3. setWinningBidder validates against its stale read → A still passes
  //   4. setWinningBidder writes { winningBidder: A, status: ENDED }
  //   5. A wins despite B holding the higher bid
  //
  // With the lock: the bid-worker and setWinningBidder are mutually exclusive.
  // Any in-flight bid completes first; then we read the authoritative state.
  const lockToken = `set-winner:${item._id}:${Date.now()}`;
  const acquired = await acquireBidLockWithWait(item._id.toString(), lockToken);
  if (!acquired) {
    throw new ForbiddenError(
      'A bid is currently being processed for this lot — please try again in a moment',
    );
  }

  try {
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

    // For manual-bid (livestream) lots, awarding the winner also ends the lot.
    // Timed lots are already ENDED by the cron before this point.
    const update: any = { winningBidder: input.bidderId };
    if (item.isBidIncrementedManually) {
      update.status = EItemStatus.ENDED;
    }

    return await Item.findByIdAndUpdate(
      item._id,
      { $set: update },
      { new: true },
    ) as IItem;
  } finally {
    await releaseBidLock(item._id.toString(), lockToken);
  }
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

  // Use findByIdAndUpdate to bypass full-document validation — items created
  // before required fields were added (e.g. bidIncrement) would fail item.save().
  return await Item.findByIdAndUpdate(
    item._id,
    { $set: { winningBidder: winningBid.userId } },
    { new: true },
  );
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
 * Uses bulkWrite (no MongoDB session/transaction) so it works on both
 * standalone and replica-set deployments.
 *
 * - Marks items as `ENDED` if their `endTime` has passed.
 * - Marks items as `ACTIVE` if their `startTime` has passed and they are still `NOT_BEGUN`.
 * - Safety net: closes any lots still ACTIVE/NOT_BEGUN whose parent auction is already ENDED.
 *
 * @throws {Error} If an error occurs during the database update operation.
 * @return {Promise<void>} A promise that resolves once the updates are complete.
 */
async function trackItemStatus(): Promise<void> {
  try {
    const now = new Date();

    // Find ended auction IDs for orphaned-lot detection.
    const endedAuctionIds = await Auction.distinct('_id', {
      status: EAuctionStatus.ENDED,
    });

    const [itemsToEnd, itemsToActivate, orphanedItems] = await Promise.all([
      Item.find(
        { endTime: { $lte: now }, status: { $ne: EItemStatus.ENDED } },
        { _id: 1, isClosedBidding: 1 },
      ),
      Item.find(
        { startTime: { $lte: now }, status: EItemStatus.NOT_BEGUN },
        { _id: 1 },
      ),
      // Safety net: lots still ACTIVE/NOT_BEGUN whose auction is already ENDED.
      Item.find(
        {
          auctionId: { $in: endedAuctionIds },
          status: { $in: [EItemStatus.ACTIVE, EItemStatus.NOT_BEGUN] },
        },
        { _id: 1, isClosedBidding: 1 },
      ),
    ]);

    const sealedItemIdsJustEnded: string[] = [];
    const itemsToUpdate = new Map<string, { _id: any; newStatus: EItemStatus }>();

    itemsToEnd.forEach(item => {
      itemsToUpdate.set(item._id.toString(), { _id: item._id, newStatus: EItemStatus.ENDED });
      if (item.isClosedBidding) sealedItemIdsJustEnded.push(item._id.toString());
    });

    itemsToActivate.forEach(item => {
      itemsToUpdate.set(item._id.toString(), { _id: item._id, newStatus: EItemStatus.ACTIVE });
    });

    // Orphaned lots override any ACTIVE assignment above.
    orphanedItems.forEach(item => {
      itemsToUpdate.set(item._id.toString(), { _id: item._id, newStatus: EItemStatus.ENDED });
      if (item.isClosedBidding && !sealedItemIdsJustEnded.includes(item._id.toString())) {
        sealedItemIdsJustEnded.push(item._id.toString());
      }
    });

    if (itemsToUpdate.size > 0) {
      const bulkOps = Array.from(itemsToUpdate.values()).map(({ _id, newStatus }) => ({
        updateOne: {
          filter: { _id },
          update: { $set: { status: newStatus } },
        },
      }));
      await Item.bulkWrite(bulkOps);
    }

    // Decrypt sealed bids for items that just ended.
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
    // Query all ENDED lots with no winner — intentionally omits endTime filter
    // so lots force-ended by the auction cascade (whose individual endTime may
    // still be in the future) are also processed.
    const justEndedItems = await Item.find(
      { status: EItemStatus.ENDED, winningBidder: null },
      { _id: 1 },
    );

    if (justEndedItems.length > 0) {
      await Promise.all(
        justEndedItems.map((item) =>
          autoSelectWinner(item._id.toString())
            .then((result) => {
              if (result?.winningBidder) {
                const itemId = item._id.toString();
                socketEmitter
                  .to(`${itemId}-bid`)
                  .emit(ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING, itemId);
              }
            })
            .catch((err: Error) =>
              console.error(
                `[item-service] autoSelectWinner failed for item ${item._id}: ${err.message}`,
              ),
            ),
        ),
      );
    }
  } catch (error) {
    console.error('Error in trackItemStatus:', error);
    throw error;
  }
}

/**
 * Return ENDED items that have a winner set and still have COMPLETED RESERVATION
 * transactions for non-winners that have not yet been refunded.
 * Used by the open-router to trigger non-winner refunds after trackItemStatus.
 */
async function getItemsWithWinnerForRefund(): Promise<IItem[]> {
  return await Item.find(
    {
      status: EItemStatus.ENDED,
      winningBidder: { $exists: true, $ne: null },
      nonWinnerRefundsInitiated: { $ne: true },
    },
    { _id: 1, winningBidder: 1 }
  );
}

// Export default
export default {
  createItem,
  updateItem,
  setWinningBidder,
  autoSelectWinner,
  updateItemWithBid,
  getManualBidAmount,
  setNewBidAmountManually,
  getEligibleBidders,
  deleteItem,
  cancelItem,
  trackItemStatus,
  getByTitleSlug,
  getById,
  getItems,
  getItemsWon,
  getItemsWithWinnerForRefund,
  addInvitedBidders,
  removeInvitedBidder,
  getInvitedBidders,
  isInvited,
} as const;

// ── Invited bidder helpers ─────────────────────────────────────────────────

/**
 * Add bidders to the item's invitedBidders list.
 */
async function addInvitedBidders(itemId: string, bidderIds: string[]): Promise<IItem> {
  const item = await getById(itemId);
  if (!item) throw new NotFoundError('Item not found');

  const existing = new Set((item.invitedBidders || []).map(String));
  for (const id of bidderIds) {
    if (!existing.has(String(id))) {
      item.invitedBidders.push(id as any);
    }
  }
  return await item.save();
}

/**
 * Remove a bidder from the item's invitedBidders list.
 */
async function removeInvitedBidder(itemId: string, bidderId: string): Promise<IItem> {
  const item = await getById(itemId);
  if (!item) throw new NotFoundError('Item not found');

  item.invitedBidders = (item.invitedBidders || []).filter(
    (id: any) => id.toString() !== bidderId
  );
  return await item.save();
}

/**
 * Get invited bidders for an item with full details.
 */
async function getInvitedBidders(itemId: string): Promise<IBidder[]> {
  const item = await getById(itemId, { invitedBidders: 1 });
  if (!item) throw new NotFoundError('Item not found');

  if (!item.invitedBidders || item.invitedBidders.length === 0) return [];

  return await Bidder.find({ _id: { $in: item.invitedBidders } }).select('-__v');
}

/**
 * Check whether a specific user is invited to a lot.
 * Checks both the item-level and auction-level invited bidder lists.
 */
async function isInvited(itemId: string, userId: string): Promise<boolean> {
  const item = await getById(itemId, { invitedBidders: 1, auctionId: 1 });
  if (!item) throw new NotFoundError('Item not found');

  const inItem = (item.invitedBidders || []).some((id: any) => id.toString() === userId);
  if (inItem) return true;

  const auction = await Auction.findById(item.auctionId).select('invitedBidders').lean();
  if (!auction) return false;

  return (auction.invitedBidders || []).some((id: any) => id.toString() === userId);
}