import { IAdmin, IBidder } from "../models/user-model";
import { ForbiddenError, InternalServerError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession } from 'mongoose';
import { ITransaction, Transaction, ITransactionInput } from "../models/transaction-model";
import { Item } from "../models/item-model";
import { Forum } from "../models/forum-model";
import { Auction } from "../models/auction-model";
import itemService from "./item-service";
import { EPaymentStatus, ERefundReason, ESortOrderType, ETransactionSortType, ETransactionType, LIST_LIMIT_NUMBER, LOCAL_NATIONALITY, MAX_LIST_LIMIT_NUMBER, PAYGATE_ENCRYPTION_KEY, PAYGATE_ID, SERVICE_URLS, transactionType, LOCAL_CURRENCY, DEFAULT_LANG, DEFAULT_PAYMENT_EMAIL, LOCALY_COUNTRY_ALPHA_3_CODE } from "../globals";
import bidService from "./bid-service";
import * as luxon from "luxon";
import { callPayGateInitiate, prefixWithZero, convertToPaygateFormat } from "../shared/functions";
import tokenService from "./token-service";
import auctionService from "./auction-service";
import forumService from "./forum-service";
import { BidderCounter } from "../models/bidder-counter";
import collectionService from "./collection-service";

/**
 * Intiates a reservation payment transaction for an item.
 * 
 * @param currentUser
 * @param input
 * @return 
 */
async function initiateItemReservation(currentUser: IBidder, input: { itemId: string }): Promise<ITransaction> {
  try {

    const [item, token] = await Promise.all([itemService.getById(input.itemId, { reservePrice: 1, sellerId: 1, auctionId: 1, invitedBidders: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!token) {
      throw new NotFoundError('Token not found');
    }

    // Find auction
    const auction = await auctionService.getById(item.auctionId, { participationType: 1, isInviteOnly: 1, invitedBidders: 1, hasRegistrationFee: 1, registrationFee: 1 });

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    // Check participation type
    if (auction.participationType === 'CITIZEN_ONLY') {
      // Check current bidder nationality
      if (currentUser.nationality !== LOCAL_NATIONALITY) {
        throw new ForbiddenError('This auction is reserved for citizens only');
      }
    }

    // Pre-invite gate for invite-only auctions
    if (auction.isInviteOnly) {
      const bidderId = currentUser.id.toString();
      const isAuctionInvited = auction.invitedBidders?.some(
        (id: any) => id.toString() === bidderId
      );
      const isLotInvited = item.invitedBidders?.some(
        (id: any) => id.toString() === bidderId
      );
      if (!isAuctionInvited && !isLotInvited) {
        throw new ForbiddenError(
          'You must be invited to this auction before paying the reservation fee'
        );
      }
    }

    const now = luxon.DateTime.now().setZone(currentUser.tz);
    const endOfDate = now.endOf('day');

    // Determine reservation amount: use auction-level registration fee when set,
    // otherwise fall back to the item's reserve price.
    const reservationAmount = auction.hasRegistrationFee
      ? (auction.registrationFee || 0)
      : item.reservePrice;

    // Create payment transaction
    const paymentInput: ITransactionInput = {
      auctionId: item.auctionId,
      currency: LOCAL_CURRENCY,
      transactionType: 'RESERVATION',
      itemId: item.id,
      amount: reservationAmount,
      buyerId: currentUser.id,
      sellerId: item.sellerId,
      metadata: {}
    };

    const newReservation = new Transaction(paymentInput);

    // Save transaction
    const savedReservation = await newReservation.save();

    // Generate payment link using PayGate
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedReservation.id.toString(), savedReservation.amount, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/paygateReturn?auctionId=${item.auctionId.toString()}&itemId=${item._id.toString()}&type=reservation`, savedReservation.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

    const { paymentLink, payRequestId } = await callPayGateInitiate(formattedString);

    (savedReservation.metadata as Map<string, string>).set('paymentLink', paymentLink);
    (savedReservation.metadata as Map<string, string>).set('PAY_REQUEST_ID', payRequestId);

    // Save payment transaction
    await savedReservation.save();

    return savedReservation;

  } catch (error) {
    throw error;
  }
}

/**
 * Purchase an item by winning bidder.
 * 
 * @param currentUser
 * @param input
 * @return 
 */
async function initiatePurchaseItemByWinningBidder(currentUser: IBidder, input: { itemId: string }): Promise<ITransaction> {
  try {

    const [item, token] = await Promise.all([itemService.getById(input.itemId, { reservePrice: 1, sellerId: 1, winningBidder: 1, auctionId: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!token) {
      throw new NotFoundError('Token not found');
    }

    // If winningBidder not yet assigned (cron lag), attempt to assign it now.
    if (!item.winningBidder) {
      const resolved = await itemService.autoSelectWinner(input.itemId);
      if (!resolved?.winningBidder) {
        throw new InternalServerError('Winning bidder not found');
      }
      item.winningBidder = resolved.winningBidder;
    }

    if (item.winningBidder.toString() !== currentUser.id.toString()) {
      throw new InternalServerError('Not the winning bidder');
    }

    // Find reservation by item
    const [reservation, auction] = await Promise.all([Transaction.findOne({ itemId: item._id, buyerId: item.winningBidder }, { _id: 1 }), auctionService.getById(item.auctionId, { hasRegistrationFee: 1 })]);

    // Check if exists
    if (!reservation) {
      throw new NotFoundError('Transaction not found');
    }

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    const winningBid = await bidService.getWinningBid(input.itemId);

    // Check if exists
    if (!winningBid) {
      throw new NotFoundError('Bid not found');
    }

    const now = luxon.DateTime.now().setZone(currentUser.tz);
    const endOfDate = now.endOf('day');
    let amount = 0;
    // TODO: Check for "Registration Fee"
    if (auction.hasRegistrationFee) {
      const completedRegistration = await Transaction.findOne({ buyerId: item.winningBidder, auctionId: auction._id, transactionType: "PURCHASE", status: EPaymentStatus.COMPLETED }, { _id: 1 });
      if (completedRegistration) {
        amount = winningBid.bidAmount;
      } else {
        amount = winningBid.bidAmount - item.reservePrice;
      }
    } else {
      amount = winningBid.bidAmount - item.reservePrice;
    }

    // Guard: if already paid, do not initiate another transaction.
    const completedPurchase = await Transaction.findOne({
      itemId: item._id,
      buyerId: currentUser.id,
      transactionType: ETransactionType.PURCHASE,
      status: EPaymentStatus.COMPLETED,
    });
    if (completedPurchase) {
      throw new InternalServerError('This item has already been paid for');
    }

    // Reuse an existing PENDING/FAILED/CANCELLED transaction only if it has never
    // been submitted to PayGate (no PAY_REQUEST_ID in metadata — e.g. the cron
    // auto-created placeholder). If a prior PayGate session exists for that record,
    // PayGate will reject a re-submission with the same reference ID, so we create
    // a fresh transaction record with a new ID instead.
    const existingPurchase = await Transaction.findOne({
      itemId: item._id,
      buyerId: currentUser.id,
      transactionType: ETransactionType.PURCHASE,
      status: { $in: [EPaymentStatus.PENDING, EPaymentStatus.FAILED, EPaymentStatus.CANCELLED] },
    });

    const existingHadPayGateSession = existingPurchase
      && (existingPurchase.metadata as Map<string, string>).get('PAY_REQUEST_ID');

    const savedPurchase = (existingPurchase && !existingHadPayGateSession)
      ? existingPurchase
      : new Transaction({
          auctionId: item.auctionId,
          currency: LOCAL_CURRENCY,
          transactionType: 'PURCHASE',
          itemId: item.id,
          amount,
          buyerId: currentUser.id,
          sellerId: item.sellerId,
          relatedTransaction: reservation._id,
          metadata: {}
        } as ITransactionInput);

    if (!savedPurchase.isNew && savedPurchase.status !== EPaymentStatus.PENDING) {
      savedPurchase.status = EPaymentStatus.PENDING;
    }

    // Always re-initiate with PayGate — refreshes the payment link in case the
    // previous one expired (PayGate links are short-lived).
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedPurchase.id.toString(), savedPurchase.amount, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/paygateReturn?auctionId=${item.auctionId.toString()}&itemId=${item._id.toString()}&type=purchase`, savedPurchase.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

    const { paymentLink, payRequestId } = await callPayGateInitiate(formattedString);

    (savedPurchase.metadata as Map<string, string>).set('paymentLink', paymentLink);
    (savedPurchase.metadata as Map<string, string>).set('PAY_REQUEST_ID', payRequestId);

    await savedPurchase.save();

    return savedPurchase;

  } catch (error) {
    throw error;
  }
}

/**
 * Purchase item using buyout price.
 * 
 * @param currentUser
 * @param input
 * @return 
 */
async function initiatePurchaseItemUsingBuyoutPrice(currentUser: IBidder, input: { itemId: string }): Promise<ITransaction> {
  try {

    // TODO: Make sure bidder can not purchase once bidding has begun

    const [item, token] = await Promise.all([itemService.getById(input.itemId, { buyoutPrice: 1, sellerId: 1, auctionId: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!token) {
      throw new NotFoundError('Token not found');
    }

    // Find auction
    const auction = await auctionService.getById(item.auctionId, { participationType: 1 });

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    // Check participation type
    if (auction.participationType === 'CITIZEN_ONLY') {
      // Check current bidder nationality
      if (currentUser.nationality !== LOCAL_NATIONALITY) {
        throw new ForbiddenError('This auction is reserved for citizens only');
      }
    }

    // Check if buyout price is set
    if (!item.buyoutPrice) {
      throw new InternalServerError('Buy out price is not set');
    }

    const now = luxon.DateTime.now().setZone(currentUser.tz);
    const endOfDate = now.endOf('day');

    // Create payment transaction
    const paymentInput: ITransactionInput = {
      auctionId: item.auctionId,
      currency: LOCAL_CURRENCY,
      transactionType: 'PURCHASE',
      itemId: item.id,
      amount: item.buyoutPrice,
      buyerId: currentUser.id,
      sellerId: item.sellerId,
      metadata: {}
    };

    const newPurchase = new Transaction(paymentInput);

    // Save payment transaction
    const savedPurchase = await newPurchase.save();

    // Generate payment link using PayGate
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedPurchase.id.toString(), item.buyoutPrice, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/paygateReturn?auctionId=${item.auctionId.toString()}&itemId=${item._id.toString()}&type=purchase`, savedPurchase.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

    const { paymentLink, payRequestId } = await callPayGateInitiate(formattedString);

    (savedPurchase.metadata as Map<string, string>).set('paymentLink', paymentLink);
    (savedPurchase.metadata as Map<string, string>).set('PAY_REQUEST_ID', payRequestId);

    await savedPurchase.save();

    return savedPurchase;

  } catch (error) {
    throw error;
  }
}

/**
 * Polls for a paid transaction
 * 
 * @param currentUser 
 * @param input 
 * @return 
 */
async function pollPaidTransaction (currentUser: IBidder, input: { itemId: string, transactionType: transactionType }): Promise<boolean> {
  try {
    const query = { transactionType: input.transactionType, itemId: input.itemId, buyerId: currentUser._id, status: EPaymentStatus.COMPLETED };
    console.log('[pollPaidTransaction] query:', JSON.stringify(query));
    console.log('[pollPaidTransaction] currentUser._id:', currentUser._id, 'type:', typeof currentUser._id);

    // Also check: are there ANY transactions for this user+item, regardless of status?
    const anyTx = await Transaction.findOne({ transactionType: input.transactionType, itemId: input.itemId, buyerId: currentUser._id });
    if (anyTx) {
      console.log('[pollPaidTransaction] found transaction for user+item:', {
        id: anyTx._id,
        status: anyTx.status,
        itemId: anyTx.itemId,
        buyerId: anyTx.buyerId,
        amount: anyTx.amount,
      });
    } else {
      console.log('[pollPaidTransaction] no transaction found for user+item at all');
    }

    const transaction = await Transaction.findOne(query, { _id: 1 });

    console.log('[pollPaidTransaction] result:', transaction ? 'COMPLETED reservation found' : 'no completed reservation');
    return transaction ? true : false;

  } catch (error) {
    throw error;
  }
}

/**
 * Process a successful payment from the PayGate platform
 * 
 * @param input 
 */
async function processSuccessfulPaymentFromPayGate(input: {
  REFERENCE: string,
  PAY_METHOD?: string,
  PAY_METHOD_DETAIL?: string,
  TRANSACTION_STATUS: string,
  RESULT_CODE: string,
  RESULT_DESC?: string,
}) {

  let sess: ClientSession | null = null;

  try {
    let needle = false;

    // Find transaction
    const transaction = await getById(input.REFERENCE);

    // Check if exists
    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    // Idempotency guard — PayGate may retry NOTIFY_URL up to 2 times.
    // If we have already fully processed this transaction, return it as-is.
    if (transaction.status === EPaymentStatus.COMPLETED) {
      return transaction;
    }

    const meta = transaction.metadata as Map<string, string>;
    meta.set('resultCode', input.RESULT_CODE);
    if (input.RESULT_DESC) meta.set('resultDesc', input.RESULT_DESC);

    // Handle transaction status codes
    switch (input.TRANSACTION_STATUS) {
      case "1": // Approved
        transaction.status = EPaymentStatus.COMPLETED;
        transaction.paymentMethod = input.PAY_METHOD && input.PAY_METHOD_DETAIL
          ? `${input.PAY_METHOD} - ${input.PAY_METHOD_DETAIL}`
          : input.PAY_METHOD || 'Unknown';
        break;

      case "2": // Declined or Insufficient Funds — differentiate by RESULT_CODE
        transaction.status = EPaymentStatus.FAILED;
        if (input.RESULT_CODE === '900003') {
          meta.set('failReason', 'INSUFFICIENT_FUNDS');
        } else if (input.RESULT_CODE === '900007') {
          meta.set('failReason', 'DECLINED');
        } else {
          meta.set('failReason', 'DECLINED');
        }
        await transaction.save();
        return transaction;

      case "0": // Not Done
        transaction.status = EPaymentStatus.PENDING;
        await transaction.save();
        return transaction;

      case "3": // Cancelled by PayGate
      case "4": // Cancelled by user
        transaction.status = EPaymentStatus.CANCELLED;
        await transaction.save();
        return transaction;

      case "5": // Received by PayGate (awaiting settlement)
        transaction.status = EPaymentStatus.PENDING;
        await transaction.save();
        return transaction;

      case "7": // Settlement Voided
        transaction.status = EPaymentStatus.FAILED;
        meta.set('failReason', 'VOIDED');
        await transaction.save();
        return transaction;

      default:
        transaction.status = EPaymentStatus.FAILED;
        meta.set('failReason', `UNKNOWN_STATUS_${input.TRANSACTION_STATUS}`);
        await transaction.save();
        return transaction;
    }

    // Start session and mongo ACID transaction
    sess = await startSession();

    // Find item
    const item = await itemService.getById(transaction.itemId);

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Handle transaction types
    if (transaction.transactionType === 'RESERVATION') {
      const forum = await forumService.getForumByAuctionId(item.auctionId);
      if (!forum) {
        throw new NotFoundError('Forum not found');
      }

      const stringBuyerId = transaction.buyerId.toString();

      // Atomic $addToSet prevents duplicates even when NOTIFY_URL fires concurrently.
      await Item.updateOne(
        { _id: item._id },
        { $addToSet: { eligibleBidders: stringBuyerId } },
        { session: sess }
      );

      await Forum.updateOne(
        { _id: forum._id },
        { $addToSet: { participants: stringBuyerId } },
        { session: sess }
      );

      const auction = await auctionService.getById(item.auctionId);
      if (!auction) {
        throw new NotFoundError('Auction not found');
      }

      if (auction.hasRegistrationFee) {
        await Auction.updateOne(
          { _id: auction._id },
          { $addToSet: { globallyEligibleBidders: stringBuyerId } },
          { session: sess }
        );
      }

      if (auction.participantsWithBiddingNumbers.length > 0) {
        for (let index = 0; index < auction.participantsWithBiddingNumbers.length; index++) {
          const element = auction.participantsWithBiddingNumbers[index];
          if (element.includes(stringBuyerId)) {
            needle = true;
            break;
          }
        }
      }

      if (!needle) {
        const bidderCounter = await BidderCounter.findOneAndUpdate(
          { auctionId: item.auctionId },
          { $inc: { sequenceValue: 1 } },
          { new: true, upsert: true, session: sess }
        );

        auction.participantsWithBiddingNumbers.push(
          `${stringBuyerId}:BIDDER${prefixWithZero(bidderCounter.sequenceValue)}`
        );
        await auction.save({ session: sess });
      }

      await transaction.save({ session: sess });

    } else if (transaction.transactionType === 'PURCHASE') {
      // Save transaction status and mark item as purchased.
      // Use findByIdAndUpdate to bypass full-document validation (legacy items
      // may be missing required fields added after creation).
      await transaction.save();
      await Item.findByIdAndUpdate(item._id, { $set: { isPurchased: true } });

      // Create collection record — done outside the ACID transaction so that
      // a collection-creation failure does not roll back the payment itself.
      // The OTP code is generated here and should be delivered to the buyer.
      collectionService.createCollection(transaction.itemId, transaction._id)
        .then(({ otpCode }) => {
          // TODO: Deliver otpCode to the buyer via push notification / email.
          // The OTP is intentionally not logged to avoid leaking it.
          console.info(
            `[transaction-service] Collection created for item ${transaction.itemId.toString()}`
          );
        })
        .catch((err: Error) => {
          console.error(
            `[transaction-service] Failed to create collection for item ${transaction.itemId.toString()}: ${err.message}`
          );
        });
    }

    return transaction;

  } catch (error) {
    throw error;
  } finally {
    if (sess) {
      await sess.endSession();
    }
  }
}

/**
 * Get a transaction by id.
 * 
 * @param id 
 * @param projection
 * @return 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<ITransaction | null> {
  try {
    if (isMongoId(id.toString())) {
      const transaction = await Transaction.findById(id, projection);
      return transaction;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get transactions.
 * 
 * @param conditions
 * @param projection
 * @return 
 */
async function getTransactions(currentUser: IAdmin | IBidder, conditions: Map<string, any>, projection?: any): Promise<ITransaction[]> {
  try {

    let _limit: number = LIST_LIMIT_NUMBER;
    let _skip: number = 0;

    // Set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Set custom skip
    if (conditions.get('skip') && conditions.get('skip') >= 0) {
      _skip = conditions.get('skip');
    }

    // Query builder
    const q = Transaction.find({}, projection);

    // Filters
    if (conditions.get('itemId')) {
      q.where({ itemId: conditions.get('itemId') });
    }

    if (currentUser.userType === "BIDDER") {
      q.where({ buyerId: currentUser._id });
    } else if (currentUser.userType === "SELLER") {
      // Sellers are auto-scoped to their own transactions unless an
      // explicit buyerId filter is requested (e.g. by admin features).
      if (!conditions.get('sellerId')) {
        q.where({ sellerId: currentUser._id });
      }
      if (conditions.get('buyerId')) {
        q.where({ buyerId: conditions.get('buyerId') });
      }
    } else {
      if (conditions.get('buyerId')) {
        q.where({ buyerId: conditions.get('buyerId') });
      }
    }

    if (conditions.get('sellerId')) {
      q.where({ sellerId: conditions.get('sellerId') });
    }

    if (conditions.get('status')) {
      q.where({ status: conditions.get('status') });
    }

    if (conditions.get('transactionType')) {
      q.where({ transactionType: conditions.get('transactionType') });
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
      if (conditions.get('sortBy') === ETransactionSortType.DATE) {
        q.sort({ '_id': conditions.get('sortOrder') });
      }
      if (conditions.get('sortBy') === ETransactionSortType.AMOUNT) {
        q.sort({ 'amount': conditions.get('sortOrder') });
      }
    }

    // Pagination - Skip or Last Document ID
    if (_skip > 0) {
      q.skip(_skip);
    } else if (conditions.get('lastDocumentId')) {
      // Check the sort order
      if (conditions.get('sortOrder') === ESortOrderType.ASC || conditions.get('sortOrder') === ESortOrderType.asc) {
        q.where("_id").gt(conditions.get('lastDocumentId'));
      } else {
        q.where("_id").lt(conditions.get('lastDocumentId'));
      }
    }

    // Limit
    q.limit(_limit);

    // Populate buyerId, itemId, sellerId, and auctionId
    q.populate('buyerId')
      .populate('itemId')
      .populate('sellerId')
      .populate('auctionId', 'title');

    return await q;

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Tracks transactions that have been pending for more than 15 minutes.
 *
 * Only expires transactions where a PayGate session was actually initiated
 * (identified by the presence of PAY_REQUEST_ID in metadata). Placeholder
 * PENDING purchase transactions created automatically by the cron have no
 * PAY_REQUEST_ID and are intentionally left alive until the winner initiates
 * payment.
 *
 * @throws {Error} If an error occurs during the database update operation.
 * @return {Promise<void>} A promise that resolves once the update is complete.
 */
async function trackTransactionStatus (): Promise<void> {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    await Transaction.updateMany(
      {
        createdDate: { $lte: fifteenMinutesAgo },
        status: EPaymentStatus.PENDING,
        'metadata.PAY_REQUEST_ID': { $exists: true },
        $or: [
          { transactionType: ETransactionType.RESERVATION },
          { transactionType: ETransactionType.PURCHASE }
        ],
      },
      { $set: { status: EPaymentStatus.FAILED } }
    );
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Auto-create a PENDING purchase transaction for a lot winner immediately
 * after the cron assigns them. This ensures the transaction appears in the
 * winner's list without requiring them to visit the lot page first.
 *
 * Idempotent — skips silently if any PURCHASE transaction already exists
 * for this item + buyer combination.
 *
 * No PayGate session is initiated here. The winner uses "Retry Payment"
 * from their transactions list to get a fresh payment link when ready.
 *
 * @param itemId
 * @param winnerBidderId
 */
async function createPendingPurchaseForWinner(itemId: string, winnerBidderId: string): Promise<void> {
  try {
    // Idempotent: skip if any PURCHASE transaction already exists
    const existing = await Transaction.findOne({
      itemId,
      buyerId: winnerBidderId,
      transactionType: ETransactionType.PURCHASE,
    }, { _id: 1 });
    if (existing) return;

    const [item, winningBid] = await Promise.all([
      itemService.getById(itemId, { reservePrice: 1, sellerId: 1, auctionId: 1 }),
      bidService.getWinningBid(itemId),
    ]);
    if (!item || !winningBid) return;

    // Link to the winner's completed reservation
    const reservation = await Transaction.findOne({
      itemId,
      buyerId: winnerBidderId,
      transactionType: ETransactionType.RESERVATION,
      status: EPaymentStatus.COMPLETED,
    }, { _id: 1 });

    if (!reservation) {
      console.warn(
        `[transaction-service] No completed reservation for item ${itemId}, winner ${winnerBidderId}. Cannot auto-create purchase transaction.`,
      );
      return;
    }

    const auction = await auctionService.getById(item.auctionId, { hasRegistrationFee: 1 });
    if (!auction) return;

    let amount = winningBid.bidAmount - item.reservePrice;
    if (auction.hasRegistrationFee) {
      const completedRegistration = await Transaction.findOne({
        buyerId: winnerBidderId,
        auctionId: auction._id,
        transactionType: ETransactionType.PURCHASE,
        status: EPaymentStatus.COMPLETED,
      }, { _id: 1 });
      if (completedRegistration) {
        amount = winningBid.bidAmount;
      }
    }

    const purchase = new Transaction({
      auctionId: item.auctionId,
      currency: LOCAL_CURRENCY,
      transactionType: ETransactionType.PURCHASE,
      itemId: item._id,
      amount,
      buyerId: winnerBidderId as any,
      sellerId: item.sellerId,
      relatedTransaction: reservation._id,
      metadata: {},
    } as ITransactionInput);

    await purchase.save();
    console.info(
      `[transaction-service] Auto-created pending purchase for item ${itemId}, winner ${winnerBidderId}`,
    );
  } catch (error) {
    console.error(
      `[transaction-service] createPendingPurchaseForWinner failed for item ${itemId}: ${(error as Error).message}`,
    );
  }
}

/**
 * Initiate a PayGate refund for a disputed collection.
 * Creates a REFUND transaction linked to the original PURCHASE transaction.
 *
 * TODO: Call the PayGate refund API endpoint with the PAY_REQUEST_ID stored
 *       in the original transaction's metadata once the endpoint is confirmed.
 *       The REFUND transaction status should be updated via processRefundFromPayGate
 *       when PayGate posts back.
 *
 * @param purchaseTransactionId
 */
async function initiateDisputeRefund(purchaseTransactionId: string): Promise<ITransaction> {
  try {
    const purchaseTx = await getById(purchaseTransactionId);

    if (!purchaseTx) {
      throw new NotFoundError('Purchase transaction not found');
    }

    if (purchaseTx.transactionType !== ETransactionType.PURCHASE) {
      throw new ForbiddenError('Refund can only be initiated against a PURCHASE transaction');
    }

    const refundInput: ITransactionInput = {
      auctionId: purchaseTx.auctionId,
      itemId: purchaseTx.itemId,
      buyerId: purchaseTx.buyerId,
      sellerId: purchaseTx.sellerId,
      currency: purchaseTx.currency,
      amount: purchaseTx.amount,
      transactionType: ETransactionType.REFUND,
      relatedTransaction: purchaseTx._id,
      metadata: {}
    };

    const refundTx = new Transaction(refundInput);
    refundTx.status = EPaymentStatus.PENDING;

    // Store the original PAY_REQUEST_ID so the PayGate refund API can reference it.
    const originalPayRequestId = (purchaseTx.metadata as Map<string, string>).get('PAY_REQUEST_ID');
    if (originalPayRequestId) {
      (refundTx.metadata as Map<string, string>).set('originalPAY_REQUEST_ID', originalPayRequestId);
    }

    // TODO: Call PayGate refund endpoint here once confirmed.
    //   const refundResponse = await fetch(`${SERVICE_URLS.paygateBaseURI}/refund.trans`, { ... });

    return await refundTx.save();
  } catch (error) {
    throw error;
  }
}

/**
 * Initiate reservation refunds for all non-winning bidders after a winner is selected.
 * Creates a REFUND transaction (PENDING) for each losing bidder who paid the reserve price.
 *
 * TODO: Call the PayGate refund API for each refund once the endpoint is confirmed.
 *
 * @param itemId
 * @param winningBidderId
 */
async function initiateNonWinnerReservationRefunds(itemId: string, winningBidderId: string): Promise<void> {
  try {
    const losingReservations = await Transaction.find({
      itemId,
      transactionType: ETransactionType.RESERVATION,
      status: EPaymentStatus.COMPLETED,
      buyerId: { $ne: winningBidderId }
    });

    if (losingReservations.length === 0) {
      return;
    }

    const refundPromises = losingReservations.map(async (reservation) => {
      // Skip if a refund already exists for this reservation
      const existingRefund = await Transaction.findOne({
        relatedTransaction: reservation._id,
        transactionType: ETransactionType.REFUND
      });

      if (existingRefund) {
        return;
      }

      const refundInput: ITransactionInput = {
        auctionId: reservation.auctionId,
        itemId: reservation.itemId,
        buyerId: reservation.buyerId,
        sellerId: reservation.sellerId,
        currency: reservation.currency,
        amount: reservation.amount,
        transactionType: ETransactionType.REFUND,
        relatedTransaction: reservation._id,
        metadata: {}
      };

      const refundTx = new Transaction(refundInput);
      refundTx.status = EPaymentStatus.PENDING;

      const originalPayRequestId = (reservation.metadata as Map<string, string>).get('PAY_REQUEST_ID');
      if (originalPayRequestId) {
        (refundTx.metadata as Map<string, string>).set('originalPAY_REQUEST_ID', originalPayRequestId);
      }

      // TODO: Call PayGate refund endpoint here once confirmed.
      //   const refundResponse = await fetch(`${SERVICE_URLS.paygateBaseURI}/refund.trans`, { ... });

      await refundTx.save();
    });

    await Promise.allSettled(refundPromises).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.error(
          `[transaction-service] ${failed.length} non-winner refund(s) failed to initiate for item ${itemId}`
        );
      } else {
        console.info(
          `[transaction-service] Initiated ${losingReservations.length} non-winner refund(s) for item ${itemId}`
        );
      }
    });
  } catch (error) {
    console.error('[transaction-service] initiateNonWinnerReservationRefunds error:', error);
    throw error;
  }
}

// Export default
export default {
  initiateItemReservation,
  pollPaidTransaction,
  processSuccessfulPaymentFromPayGate,
  initiatePurchaseItemByWinningBidder,
  initiatePurchaseItemUsingBuyoutPrice,
  getTransactions,
  trackTransactionStatus,
  getById,
  initiateDisputeRefund,
  initiateNonWinnerReservationRefunds,
  createPendingPurchaseForWinner,
} as const;