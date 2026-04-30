import { IBidder } from "../models/user-model";
import { Bid, IBid, IBidInput } from "../models/bid-model";
import { Item } from "../models/item-model";
import { BidEvent } from "../models/bid-event-model";
import { encryptBidAmount, decryptBidAmount } from "../shared/bid-crypto";
import itemService from "./item-service";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { ClientSession, Schema, startSession } from 'mongoose';
import { EBidSortType, ESortOrderType, EItemStatus, EParticipationType, EIdentityNumberVerificationStatus, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { isMongoId } from "validator";
import auctionService from "./auction-service";

// ─────────────────────────────────────────────────────────────────────────────
// Internal transaction helper
// ─────────────────────────────────────────────────────────────────────────────

interface BidTransactionOptions {
  /**
   * Mode-specific amount check.  Called inside the transaction after the item
   * has been re-fetched with the session, so it always sees committed state.
   * Throw a ForbiddenError to reject the bid.
   */
  validateAmount: (item: any) => void;
  /** When true, enforce the one-bid-per-bidder rule (Mode 3 sealed). */
  enforceOneBidPerBidder: boolean;
  /**
   * Optional hook called on the unsaved Bid document just before `newBid.save()`.
   * Use this to apply mode-specific field transforms (e.g. encryption for sealed
   * bids) without duplicating the transaction boilerplate.
   */
  transformBid?: (bid: any) => void;
}

/**
 * Core bid transaction shared by all three auction modes.
 *
 * All validation runs INSIDE the MongoDB transaction so every check is against
 * the latest committed state.  Idempotency is checked beforehand (outside the
 * tx) to short-circuit duplicate socket retransmissions cheaply.
 */
async function _runBidTransaction(
  currentUser: IBidder,
  input: IBidInput,
  opts: BidTransactionOptions,
): Promise<IBid> {
  let sess: ClientSession | null = null;

  try {
    // ── Idempotency check (outside tx — cheap read, no side-effects) ──────────
    if (input.idempotencyKey) {
      const existing = await Bid.findOne({ idempotencyKey: input.idempotencyKey });
      if (existing) return existing;
    }

    const now = new Date();
    const newBid = new Bid({ ...input, userId: currentUser.id, bidTime: now });

    sess = await startSession();

    await sess.withTransaction(async () => {
      // ── Re-fetch item WITH session — this is the authoritative read ───────────
      const item = await Item.findById(input.itemId).session(sess!);
      if (!item) throw new NotFoundError('Item not found');

      // ── Auction-level constraints ─────────────────────────────────────────────
      // Fetch only the fields needed for these checks to keep the read cheap.
      const auction = await auctionService.getById(item.auctionId, {
        isInviteOnly: 1,
        participationType: 1,
        sectorType: 1,
      });
      if (!auction) throw new NotFoundError('Auction not found');

      // ── Eligibility (only enforced for invite-only auctions) ──────────────────
      if (
        auction.isInviteOnly &&
        !item.eligibleBidders.includes(currentUser.id.toString())
      ) {
        throw new ForbiddenError('You are not eligible to bid on this lot');
      }

      // ── Status ────────────────────────────────────────────────────────────────
      if (item.status === EItemStatus.NOT_BEGUN) {
        throw new ForbiddenError('Bidding for this lot has not begun');
      }
      if (item.status === EItemStatus.ENDED) {
        throw new ForbiddenError('Bidding for this lot has already ended');
      }
      if (item.status === EItemStatus.CANCELLED) {
        throw new ForbiddenError('Bidding for this lot has been cancelled');
      }

      // participationType: CITIZEN_ONLY auctions reject organisational bidders.
      if (
        auction.participationType === EParticipationType.CITIZEN_ONLY &&
        currentUser.isOrganization
      ) {
        throw new ForbiddenError(
          'This auction is restricted to individual citizens — ' +
          'organisations are not permitted to bid',
        );
      }

      // identityNumber verification: GOVERNMENT sector auctions require VERIFIED
      // national ID (OMANG/passport) before any bid is accepted.
      if (
        currentUser.identityNumberVerificationStatus !==
        EIdentityNumberVerificationStatus.VERIFIED
      ) {
        throw new ForbiddenError(
          'Your identity must be verified before you can place a bid',
        );
      }

      // ── Mode-specific amount validation ───────────────────────────────────────
      opts.validateAmount(item);

      // ── One-bid-per-bidder (Mode 3 sealed only) ───────────────────────────────
      if (opts.enforceOneBidPerBidder) {
        const existingBid = await Bid.findOne(
          { userId: currentUser.id, itemId: item.id, isRetracted: false },
          null,
          { session: sess },
        );
        if (existingBid) {
          throw new ForbiddenError('In sealed bidding you may only place one bid');
        }
      }

      // ── Atomic item update ($max — lower concurrent bid can never win) ────────
      const updated = await itemService.updateItemWithBid(item, input.bidAmount, sess!);
      if (!updated) {
        throw new Error('Concurrent bid conflict — please retry');
      }

      // Apply any mode-specific field transforms before persisting.
      if (opts.transformBid) opts.transformBid(newBid);

      await newBid.save({ session: sess });

      // ── Buyout price (Mode 1 open only — not applicable to sealed/livestream) ─
      // If the bid meets or exceeds buyoutPrice, end the auction immediately and
      // set the bidder as the winner — all within this transaction.
      if (
        !item.isClosedBidding &&
        !item.isBidIncrementedManually &&
        item.buyoutPrice &&
        input.bidAmount >= item.buyoutPrice
      ) {
        await Item.updateOne(
          { _id: item._id },
          { $set: { status: EItemStatus.ENDED, winningBidder: currentUser.id } },
          { session: sess! },
        );
      }
    });

    return newBid;
  } catch (error) {
    throw error;
  } finally {
    if (sess) await sess.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1 — Open ascending auction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Place a bid in an open ascending auction.
 *
 * Validation:
 *  - bidAmount must exceed the starting bid.
 *  - bidAmount must exceed the current leading bid.
 *  - If bidIncrement is set, bidAmount must be at least currentBid + bidIncrement
 *    (or startingBid + bidIncrement when no bids have been placed yet).
 *  - buyoutPrice: if bidAmount >= buyoutPrice the lot is closed immediately in
 *    the same transaction (handled in _runBidTransaction).
 *  - Multiple bids per bidder allowed.
 *
 * Broadcast (caller's responsibility): emit UPDATE_BID_AMOUNT to the item room.
 */
async function createOpenBid(currentUser: IBidder, input: IBidInput): Promise<IBid> {
  return _runBidTransaction(currentUser, input, {
    validateAmount: (item) => {
      const floor = item.currentBid ?? item.startingBid;

      if (input.bidAmount <= item.startingBid) {
        throw new ForbiddenError('Bid amount must be higher than the starting bid');
      }

      if (item.currentBid && input.bidAmount <= item.currentBid) {
        throw new ForbiddenError('Bid amount must be higher than the current bid');
      }

      // Enforce minimum increment if configured.
      if (item.bidIncrement) {
        const minimumBid = floor + item.bidIncrement;
        if (input.bidAmount < minimumBid) {
          throw new ForbiddenError(
            `Bid must be at least ${minimumBid} ` +
            `(current price ${floor} + increment ${item.bidIncrement})`,
          );
        }
      }
    },
    enforceOneBidPerBidder: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 2 — Livestream / auctioneer-controlled auction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a bidder's acceptance of the auctioneer's called price.
 *
 * The auctioneer drives the price via CREATE_NEW_MANUAL_BID_AMOUNT /
 * manualBidAmount on the item.  A bid here means the bidder is accepting
 * the current called price — they cannot name their own price.
 *
 * Validation:
 *  - bidAmount MUST equal item.manualBidAmount exactly.  Any other value means
 *    the client is attempting to bypass the auctioneer's price control.
 *
 * Broadcast (caller's responsibility): emit UPDATE_BID_AMOUNT — the auctioneer
 * and all viewers see who is bidding at the called price.
 *
 * Retraction: never allowed (handled in retractBid).
 */
async function createLivestreamBid(currentUser: IBidder, input: IBidInput): Promise<IBid> {
  return _runBidTransaction(currentUser, input, {
    validateAmount: (item) => {
      if (input.bidAmount !== item.manualBidAmount) {
        throw new ForbiddenError(
          `Bid amount must equal the auctioneer's called price of ${item.manualBidAmount}`,
        );
      }
    },
    enforceOneBidPerBidder: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 3 — Sealed / closed auction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a sealed bid.
 *
 * Validation:
 *  - bidAmount must exceed the starting bid.
 *  - Exactly one active bid per bidder — enforced inside the transaction to
 *    close the TOCTOU window.
 *  - currentBid is NOT used for comparison: competitors' amounts are hidden.
 *
 * Broadcast (caller's responsibility): emit SEALED_BID_ACCEPTED to the room —
 * this carries NO amount or identity, only signalling that the bid count grew.
 *
 * Retraction: never allowed (handled in retractBid).
 */
async function createSealedBid(currentUser: IBidder, input: IBidInput): Promise<IBid> {
  return _runBidTransaction(currentUser, input, {
    validateAmount: (item) => {
      if (input.bidAmount <= item.startingBid) {
        throw new ForbiddenError('Bid amount must be higher than the starting bid');
      }
      // No currentBid comparison — sealed bids must stay private until close.
    },
    enforceOneBidPerBidder: true,
    transformBid: (bid) => {
      // Encrypt the amount and zero out the plaintext field so the real value
      // is never stored unprotected.  The ciphertext is decrypted by
      // decryptSealedBids() when the item transitions to ENDED.
      bid.bidAmountEncrypted = encryptBidAmount(bid.bidAmount);
      bid.bidAmount = 0;
    },
  });
}

/**
 * Decrypt all sealed bids for an item once it has ended.
 *
 * Called by item-service.trackItemStatus() when a sealed item transitions
 * to ENDED.  Restores the real bidAmount from bidAmountEncrypted so that
 * winner determination and reporting can proceed normally.
 *
 * This is the ONLY legitimate place where sealed bid amounts are decrypted.
 *
 * @param itemId  The item whose sealed auction has just closed.
 */
async function decryptSealedBids(itemId: string): Promise<void> {
  const bids = await Bid.find({ itemId, isRetracted: false });

  const updates = bids
    .filter((bid) => bid.bidAmountEncrypted)
    .map(async (bid) => {
      try {
        const amount = decryptBidAmount(bid.bidAmountEncrypted!);
        bid.bidAmount = amount;
        bid.bidAmountEncrypted = undefined;
        await bid.save();
      } catch (err: any) {
        console.error(
          `[bid-service] Failed to decrypt sealed bid ${bid.id} for item ${itemId}: ${err.message}`,
        );
      }
    });

  await Promise.all(updates);
}

/**
 * Retract a bid.
 *
 * Rules enforced:
 *  - Mode 1 (open):      retraction allowed only while item.status === ACTIVE.
 *  - Mode 2 (livestream): retraction is NEVER allowed — bids are responses to
 *                          a called price and must stand.
 *  - Mode 3 (sealed):    retraction is NEVER allowed — sealed bids are irrevocable.
 *
 * The item is re-fetched INSIDE a transaction to close the TOCTOU window that
 * previously existed between the status check and the save.
 *
 * @param currentUser
 * @param bidId
 * @returns The retracted bid
 */
async function retractBid(currentUser: IBidder, bidId: string | Schema.Types.ObjectId): Promise<IBid> {
  let sess: ClientSession | null = null;
  let retractedBid: IBid | null = null;

  try {
    sess = await startSession();

    await sess.withTransaction(async () => {
      // Fetch bid within transaction
      const bid = await Bid.findOne(
        { _id: bidId, userId: currentUser.id },
        null,
        { session: sess },
      );
      if (!bid) throw new NotFoundError('Bid not found');

      if (bid.isRetracted) throw new ForbiddenError('Bid has already been retracted');

      // Re-fetch item within the same transaction — eliminates the TOCTOU window
      const item = await Item.findById(bid.itemId).session(sess!);
      if (!item) throw new NotFoundError('Item not found');

      // Mode 2 — livestream: no retraction ever
      if (item.isBidIncrementedManually) {
        throw new ForbiddenError(
          'Bids in a livestream auction cannot be retracted',
        );
      }

      // Mode 3 — sealed: no retraction ever
      if (item.isClosedBidding) {
        throw new ForbiddenError(
          'Sealed bids are irrevocable and cannot be retracted',
        );
      }

      // Mode 1 — open: only while the item is still active
      if (item.status !== EItemStatus.ACTIVE) {
        throw new ForbiddenError(
          'Cannot retract a bid after the lot has ended or been cancelled',
        );
      }

      bid.isRetracted = true;
      retractedBid = await bid.save({ session: sess });
    });

    // Append BID_RETRACTED audit event outside the transaction so the
    // write doesn't extend the transaction window.  Fire-and-forget.
    const rb = retractedBid!;
    Item.findById(rb.itemId, { auctionId: 1, isClosedBidding: 1, isBidIncrementedManually: 1 })
      .then((retractedItem) => {
        const mode = retractedItem?.isClosedBidding
          ? 'sealed'
          : retractedItem?.isBidIncrementedManually
            ? 'livestream'
            : 'open';
        return BidEvent.create({
          eventType: 'BID_RETRACTED',
          itemId: rb.itemId,
          auctionId: retractedItem?.auctionId ?? '000000000000000000000000',
          userId: rb.userId,
          bidId: rb.id,
          bidAmount: rb.bidAmount,
          auctionMode: mode,
        });
      })
      .catch((err: Error) =>
        console.error('[bid-service] Failed to record BID_RETRACTED event:', err.message),
      );

    return rb;
  } catch (error) {
    throw error;
  } finally {
    if (sess) await sess.endSession();
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
 * Get bids for an item.
 *
 * Sealed-auction protection (Phase 0.6):
 *   When a sealed/closed auction is still ACTIVE, individual bid amounts must
 *   not be visible to competitors — that defeats the purpose of sealed bidding.
 *   In this state we return only the caller's own bid (if any).  Once the item
 *   is ENDED the full ranked list is returned so the winner can be determined.
 *
 * conditions keys:
 *   - limit        {number}
 *   - sortBy       {EBidSortType}
 *   - sortOrder    {ESortOrderType}
 *   - lastDocumentId {string}  cursor pagination
 *   - startDate / endDate      date range
 *   - callerId     {string}    MongoDB user ID of the requesting bidder (required
 *                              for sealed-auction filtering; set by bid-router)
 *
 * @param itemId
 * @param conditions
 * @param projection
 * @returns
 */
async function getBids(itemId: string, conditions: Map<string, any>, projection?: any): Promise<IBid[]> {
  try {
    let _limit: number = LIST_LIMIT_NUMBER;

    const item = await itemService.getById(itemId, { auctionId: 1, isClosedBidding: 1, status: 1 });
    if (!item) throw new NotFoundError('Item not found');

    // ── Sealed-auction visibility gate ────────────────────────────────────────
    // During an active sealed auction competitors must not see each other's bids.
    // Return only the caller's own bid so they can confirm submission.
    if (item.isClosedBidding && item.status === EItemStatus.ACTIVE) {
      const callerId = conditions.get('callerId');
      if (!callerId) return [];

      const ownBid = await Bid.findOne(
        { itemId, userId: callerId, isRetracted: false },
        projection,
      );
      return ownBid ? [ownBid] : [];
    }

    const auction = await auctionService.getById(item.auctionId, { participantsWithBiddingNumbers: 1 });
    if (!auction) throw new NotFoundError('Auction not found');

    // Convert participantsWithBiddingNumbers array to a Map for quick lookup
    const biddingNumbersMap = new Map(
      auction.participantsWithBiddingNumbers.map(entry => {
        const [userId, bidNumber] = entry.split(':');
        return [userId, bidNumber];
      }),
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

    // Base filter — never expose retracted bids
    q.where({ itemId, isRetracted: false });

    // Date range
    if (conditions.get('startDate') && conditions.get('endDate')) {
      q.and([
        { createdDate: { $gte: new Date(conditions.get('startDate')) } },
        { createdDate: { $lte: new Date(conditions.get('endDate')) } },
      ]);
    } else if (conditions.get('startDate')) {
      q.where({ createdDate: { $gte: new Date(conditions.get('startDate')) } });
    } else if (conditions.get('endDate')) {
      q.where({ createdDate: { $lte: new Date(conditions.get('endDate')) } });
    }

    // Sort
    if (conditions.get('sortBy')) {
      if (conditions.get('sortBy') === EBidSortType.DATE) {
        q.sort({ bidTime: conditions.get('sortOrder') });
      }
      if (conditions.get('sortBy') === EBidSortType.AMOUNT) {
        q.sort({ bidAmount: conditions.get('sortOrder') });
      }
    }

    // Cursor pagination
    if (conditions.get('lastDocumentId')) {
      if (
        conditions.get('sortOrder') === ESortOrderType.ASC ||
        conditions.get('sortOrder') === ESortOrderType.asc
      ) {
        q.where('_id').gt(conditions.get('lastDocumentId'));
      } else {
        q.where('_id').lt(conditions.get('lastDocumentId'));
      }
    }

    q.limit(_limit);

    const bids = await q.exec();

    // Attach bidding numbers
    if (auction.participantsWithBiddingNumbers.length > 0) {
      bids.forEach((bid: IBid) => {
        const bidNumber = biddingNumbersMap.get(bid.userId.toString());
        if (bidNumber) bid.bidNumber = bidNumber;
      });
    }

    return bids;
  } catch (error) {
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
  createOpenBid,
  createLivestreamBid,
  createSealedBid,
  decryptSealedBids,
  getBids,
  getWinningBid,
  retractBid
} as const;
