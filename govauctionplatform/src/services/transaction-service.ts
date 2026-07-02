import { Bidder, IAdmin, IBidder } from "../models/user-model";
import { ForbiddenError, InternalServerError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession } from 'mongoose';
import { ITransaction, Transaction, ITransactionInput } from "../models/transaction-model";
import { Item } from "../models/item-model";
import { Forum } from "../models/forum-model";
import { Auction } from "../models/auction-model";
import itemService from "./item-service";
import { EPaymentStatus, EItemStatus, ERefundReason, ESortOrderType, ETransactionSortType, ETransactionType, LIST_LIMIT_NUMBER, LOCAL_NATIONALITY, MAX_LIST_LIMIT_NUMBER, PAYGATE_ENCRYPTION_KEY, PAYGATE_ID, SERVICE_URLS, transactionType, LOCAL_CURRENCY, DEFAULT_LANG, DEFAULT_PAYMENT_EMAIL, LOCALY_COUNTRY_ALPHA_3_CODE, KEY_SECRET } from "../globals";
import bidService from "./bid-service";
import * as luxon from "luxon";
import { callPayGateInitiate, prefixWithZero, convertToPaygateFormat } from "../shared/functions";
import { refundRequest } from "../shared/payhost";
import tokenService from "./token-service";
import auctionService from "./auction-service";
import forumService from "./forum-service";
import { BidderCounter } from "../models/bidder-counter";
import collectionService from "./collection-service";
import axios from "axios";

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

    // Dedup: if the bidder already has a pending or completed reservation for this
    // item, don't create a duplicate. Return the pending one so the frontend can
    // re-use its payment link; throw on completed (frontend shouldn't be calling this).
    const existingReservation = await Transaction.findOne({
      itemId: item._id,
      buyerId: currentUser.id,
      transactionType: ETransactionType.RESERVATION,
      status: { $in: [EPaymentStatus.PENDING, EPaymentStatus.COMPLETED] },
    });
    if (existingReservation) {
      if (existingReservation.status === EPaymentStatus.COMPLETED) {
        throw new InternalServerError('You have already reserved this item');
      }
      return existingReservation;
    }

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

    const [item, token] = await Promise.all([itemService.getById(input.itemId, { reservePrice: 1, sellerId: 1, winningBidder: 1, auctionId: 1, isBidIncrementedManually: 1, isClosedBidding: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!token) {
      throw new NotFoundError('Token not found');
    }

    // If winningBidder not yet assigned, handle based on lot type.
    // Sealed-bid and livestream lots must wait for the cron/auctioneer to assign the
    // winner explicitly — auto-selecting here would assign the wrong bidder.
    // Open-bidding lots can fall back to autoSelectWinner to cover cron lag.
    if (!item.winningBidder) {
      if (item.isClosedBidding || item.isBidIncrementedManually) {
        throw new InternalServerError('Winner has not been determined yet — please try again shortly');
      }
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

    const [item, token] = await Promise.all([itemService.getById(input.itemId, { buyoutPrice: 1, sellerId: 1, auctionId: 1, status: 1 }), tokenService.getActiveToken()]);

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

    // Buyout is only available before bidding starts — once the lot is ACTIVE,
    // bidders must compete through the bidding process.
    if (item.status !== 'NOT_BEGUN') {
      throw new ForbiddenError('Buyout is only available before bidding begins');
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
      metadata: { isBuyout: 'true' }
    };

    const newPurchase = new Transaction(paymentInput);

    // Save payment transaction
    const savedPurchase = await newPurchase.save();

    // Generate payment link using PayGate — type=buyout so RETURN_URL can distinguish it
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedPurchase.id.toString(), item.buyoutPrice, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/paygateReturn?auctionId=${item.auctionId.toString()}&itemId=${item._id.toString()}&type=buyout`, savedPurchase.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

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
    const transaction = await Transaction.findOne({
      transactionType: input.transactionType,
      itemId: input.itemId,
      buyerId: currentUser._id,
      status: EPaymentStatus.COMPLETED
    }, { _id: 1 });

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
  VAULT_ID?: string,
  TRANSACTION_ID?: string,
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
    // Store the Vault ID (card token) for use by PayHost when issuing refunds.
    if (input.VAULT_ID) meta.set('VAULT_ID', input.VAULT_ID);
    // Store the PayGate transaction ID — used by PayHost RefundRequest to identify the original transaction.
    if (input.TRANSACTION_ID) meta.set('TRANSACTION_ID', input.TRANSACTION_ID);

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
      const meta = transaction.metadata as Map<string, string>;
      const isBuyout = meta.get('isBuyout') === 'true';

      await transaction.save();

      if (isBuyout) {
        // Buyout: bidder paid the full buyoutPrice — set them as winner, end the item,
        // and refund all prior reservations since the lot was bought before bidding started.
        await Item.findByIdAndUpdate(item._id, {
          $set: {
            isPurchased: true,
            winningBidder: transaction.buyerId,
            status: EItemStatus.ENDED,
          },
        });

        // Refund all prior reservations — fire-and-forget so refund failures
        // don't block the payment confirmation.
        initiateCancellationRefunds(item._id.toString())
          .catch((err: Error) => {
            console.error(
              `[transaction-service] Buyout refunds failed for item ${item._id.toString()}: ${err.message}`
            );
          });
      } else {
        await Item.findByIdAndUpdate(item._id, { $set: { isPurchased: true } });
      }

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

    const purchaseMeta = purchaseTx.metadata as Map<string, string>;
    const originalPayRequestId = purchaseMeta.get('PAY_REQUEST_ID');
    if (originalPayRequestId) {
      (refundTx.metadata as Map<string, string>).set('originalPAY_REQUEST_ID', originalPayRequestId);
    }

    const savedRefund = await refundTx.save();

    // Attempt automated refund via PayHost if we can identify the original transaction.
    const transactionId = purchaseMeta.get('TRANSACTION_ID');

    if (transactionId) {
      const amountCents = Math.round(savedRefund.amount * 100);

      try {
        const { statusName, transactionId: payhostTxId, resultCode, resultDescription } =
          await refundRequest({
            merchantOrderId: String(purchaseTx._id),
            amountCents,
            reference: String(savedRefund._id),
          });

        const isCompleted = statusName.toLowerCase() === 'completed';
        if (isCompleted) {
          savedRefund.status = EPaymentStatus.COMPLETED;
          const refundMeta = savedRefund.metadata as Map<string, string>;
          if (payhostTxId) refundMeta.set('payhostTransactionId', payhostTxId);
          await savedRefund.save();
        } else {
          console.error(
            `[transaction-service] PayHost dispute refund not completed for ${savedRefund._id}: ` +
            `status=${statusName}, resultCode=${resultCode}, resultDescription=${resultDescription}`
          );
          (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
          await savedRefund.save();
        }
      } catch (err) {
        console.error('[transaction-service] PayHost dispute refund failed — flagging for manual refund:', err);
        (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
        await savedRefund.save();
      }
    } else {
      // Cannot identify original transaction — flag for manual processing
      (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
      await savedRefund.save();
    }

    return savedRefund;
  } catch (error) {
    throw error;
  }
}

/**
 * Initiate reservation refunds for all non-winning bidders after a winner is selected.
 * Creates a REFUND transaction for each losing bidder who paid the reserve price,
 * then calls PayHost to process the refund synchronously.
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
      await Item.findByIdAndUpdate(itemId, { $set: { nonWinnerRefundsInitiated: true } });
      return;
    }

    // Create REFUND transactions (idempotent — skips if one already exists)
    const refundPromises = losingReservations.map(async (reservation) => {
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

      const resMeta = reservation.metadata as Map<string, string>;
      const originalPayRequestId = resMeta.get('PAY_REQUEST_ID');
      if (originalPayRequestId) {
        (refundTx.metadata as Map<string, string>).set('originalPAY_REQUEST_ID', originalPayRequestId);
      }

      const savedRefund = await refundTx.save();
      return { savedRefund, reservation };
    });

    const settled = await Promise.allSettled(refundPromises);
    const failedCount = settled.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) {
      console.error(
        `[transaction-service] ${failedCount} non-winner refund(s) failed to initiate for item ${itemId}`
      );
    }

    const successes: Array<{ savedRefund: ITransaction; reservation: ITransaction }> = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value != null) {
        successes.push(r.value);
      }
    }

    if (successes.length === 0) return;

    // Enqueue each refund via the queue service for async processing with retry.
    // PayHost identifies the original transaction by MerchantOrderId (our MongoDB _id,
    // which was sent as REFERENCE in the original PayWeb3 call).
    const callbackUrl = `${SERVICE_URLS.auctionsGovServerBaseURI}/open/completeRefund`;
    for (const { savedRefund, reservation } of successes) {
      const resMeta = reservation.metadata as Map<string, string>;
      const transactionId = resMeta.get('TRANSACTION_ID');

      // Need the PayGate transaction ID to confirm card-based payment that can be refunded.
      // PayHost identifies the original transaction by MerchantOrderId (always available — it's our _id).
      if (!transactionId) {
        (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
        await savedRefund.save();
        continue;
      }

      try {
        const amountCents = Math.round(savedRefund.amount * 100);
        await axios.post(`${SERVICE_URLS.onlineAuctionQueueURI}/refundQueue/add-job`, {
          merchantOrderId: String(reservation._id),
          amountCents,
          reference: String(savedRefund._id),
          callbackUrl,
        }, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": KEY_SECRET
          }
        });
        console.info(
          `[transaction-service] Enqueued refund job for ${savedRefund._id} (reservation ${reservation._id})`
        );
      } catch (err) {
        console.error(
          `[transaction-service] Failed to enqueue refund for ${savedRefund._id} — flagging for manual refund:`,
          err
        );
        (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
        await savedRefund.save();
      }
    }

    // Mark the item so the cron skips it from now on.
    await Item.findByIdAndUpdate(itemId, { $set: { nonWinnerRefundsInitiated: true } });

    console.info(`[transaction-service] Initiated ${successes.length} non-winner refund(s) for item ${itemId}`);
  } catch (error) {
    console.error('[transaction-service] initiateNonWinnerReservationRefunds error:', error);
    throw error;
  }
}

/**
 * Refund ALL completed reservation transactions for a cancelled lot.
 * Unlike initiateNonWinnerReservationRefunds, there is no winning-bidder
 * exclusion — every bidder who paid the reserve gets refunded.
 *
 * Uses the same queue-based PayHost pattern: creates REFUND transactions,
 * enqueues them via the queue service, and flags `needsManualRefund` if
 * the original transaction lacks a TRANSACTION_ID.
 *
 * Idempotent — if REFUND transactions already exist for any reservation,
 * they are skipped. Marks the item with `cancellationRefundsInitiated: true`
 * so the cron won't re-process it.
 *
 * @param itemId
 */
async function initiateCancellationRefunds(itemId: string): Promise<void> {
  try {
    const reservations = await Transaction.find({
      itemId,
      transactionType: ETransactionType.RESERVATION,
      status: EPaymentStatus.COMPLETED,
    });

    if (reservations.length === 0) {
      await Item.findByIdAndUpdate(itemId, { $set: { cancellationRefundsInitiated: true } });
      return;
    }

    // Create REFUND transactions (idempotent — skips if one already exists)
    const refundPromises = reservations.map(async (reservation) => {
      const existingRefund = await Transaction.findOne({
        relatedTransaction: reservation._id,
        transactionType: ETransactionType.REFUND,
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
        metadata: {},
      };

      const refundTx = new Transaction(refundInput);
      refundTx.status = EPaymentStatus.PENDING;

      const resMeta = reservation.metadata as Map<string, string>;
      const originalPayRequestId = resMeta.get('PAY_REQUEST_ID');
      if (originalPayRequestId) {
        (refundTx.metadata as Map<string, string>).set('originalPAY_REQUEST_ID', originalPayRequestId);
      }

      const savedRefund = await refundTx.save();
      return { savedRefund, reservation };
    });

    const settled = await Promise.allSettled(refundPromises);
    const failedCount = settled.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) {
      console.error(
        `[transaction-service] ${failedCount} cancellation refund(s) failed to initiate for item ${itemId}`,
      );
    }

    const successes: Array<{ savedRefund: ITransaction; reservation: ITransaction }> = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value != null) {
        successes.push(r.value);
      }
    }

    if (successes.length === 0) {
      await Item.findByIdAndUpdate(itemId, { $set: { cancellationRefundsInitiated: true } });
      return;
    }

    const callbackUrl = `${SERVICE_URLS.auctionsGovServerBaseURI}/open/completeRefund`;
    for (const { savedRefund, reservation } of successes) {
      const resMeta = reservation.metadata as Map<string, string>;
      const transactionId = resMeta.get('TRANSACTION_ID');

      if (!transactionId) {
        (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
        await savedRefund.save();
        continue;
      }

      try {
        const amountCents = Math.round(savedRefund.amount * 100);
        await axios.post(`${SERVICE_URLS.onlineAuctionQueueURI}/refundQueue/add-job`, {
          merchantOrderId: String(reservation._id),
          amountCents,
          reference: String(savedRefund._id),
          callbackUrl,
        }, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': KEY_SECRET,
          },
        });
        console.info(
          `[transaction-service] Enqueued cancellation refund job for ${savedRefund._id} (reservation ${reservation._id})`,
        );
      } catch (err) {
        console.error(
          `[transaction-service] Failed to enqueue cancellation refund for ${savedRefund._id} — flagging for manual refund:`,
          err,
        );
        (savedRefund.metadata as Map<string, string>).set('needsManualRefund', 'true');
        await savedRefund.save();
      }
    }

    // Mark the item so we don't re-process.
    await Item.findByIdAndUpdate(itemId, { $set: { cancellationRefundsInitiated: true } });

    console.info(`[transaction-service] Initiated ${successes.length} cancellation refund(s) for item ${itemId}`);
  } catch (error) {
    console.error('[transaction-service] initiateCancellationRefunds error:', error);
    throw error;
  }
}

/**
 * Return REFUND transactions that need manual processing (no Vault ID / TransactionId
 * was available on the original transaction, or the PayHost refund call failed).
 * Used by admin to identify refunds that must be issued through the banking portal.
 */
async function getPendingManualRefunds(): Promise<ITransaction[]> {
  return Transaction.find({
    transactionType: ETransactionType.REFUND,
    status: EPaymentStatus.PENDING,
    'metadata.needsManualRefund': 'true',
  }).sort({ createdDate: -1 }).lean();
}

async function markManualRefundComplete(transactionId: string, note?: string): Promise<ITransaction> {
  if (!isMongoId(transactionId)) throw new ForbiddenError('Invalid transactionId');

  const transaction = await Transaction.findById(transactionId);
  if (!transaction) throw new NotFoundError('Transaction not found');
  if (transaction.transactionType !== ETransactionType.REFUND) throw new ForbiddenError('Transaction is not a refund');
  if (transaction.metadata?.get('needsManualRefund') !== 'true') throw new ForbiddenError('Transaction does not require manual refund');

  transaction.status = EPaymentStatus.COMPLETED;
  transaction.metadata?.set('needsManualRefund', 'false');
  transaction.metadata?.set('manualRefundCompletedAt', new Date().toISOString());
  if (note) transaction.metadata?.set('manualRefundNote', note);

  await transaction.save();
  return transaction.toObject();
}

/**
 * Callback handler for the refund queue worker.
 * Called by the queue service after PayHost processes a refund.
 * Updates the refund transaction status based on the PayHost response.
 *
 * Idempotent: if the transaction is already COMPLETED, returns it as-is.
 */
async function completeRefund(input: {
  refundTransactionId: string;
  payhostTransactionId?: string;
  statusName: string;
  resultCode: string;
  resultDescription: string;
}): Promise<ITransaction> {
  try {
    const transaction = await Transaction.findById(input.refundTransactionId);
    if (!transaction) {
      throw new NotFoundError('Refund transaction not found');
    }
    if (transaction.transactionType !== ETransactionType.REFUND) {
      throw new ForbiddenError('Transaction is not a refund');
    }

    // Idempotency guard
    if (transaction.status === EPaymentStatus.COMPLETED) {
      return transaction;
    }

    const meta = transaction.metadata as Map<string, string>;

    const isCompleted = input.statusName.toLowerCase() === 'completed';
    if (isCompleted) {
      transaction.status = EPaymentStatus.COMPLETED;
      if (input.payhostTransactionId) meta.set('payhostTransactionId', input.payhostTransactionId);
      // Clear the manual flag since automated refund succeeded
      meta.delete('needsManualRefund');
    } else {
      console.error(
        `[transaction-service] PayHost refund not completed for ${input.refundTransactionId}: ` +
        `status=${input.statusName}, resultCode=${input.resultCode}, resultDescription=${input.resultDescription}`
      );
      meta.set('needsManualRefund', 'true');
    }

    meta.set('resultCode', input.resultCode);
    if (input.resultDescription) meta.set('resultDescription', input.resultDescription);

    await transaction.save();
    return transaction;
  } catch (error) {
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
  initiateCancellationRefunds,
  createPendingPurchaseForWinner,
  getPendingManualRefunds,
  markManualRefundComplete,
  completeRefund,
} as const;