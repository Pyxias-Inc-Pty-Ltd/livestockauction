import { IAdmin, IBidder } from "../models/user-model";
import { ForbiddenError, InternalServerError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession } from 'mongoose';
import { ITransaction, Transaction, ITransactionInput } from "../models/transaction-model";
import itemService from "./item-service";
import { EPaymentStatus, ERefundReason, ESortOrderType, ETransactionSortType, ETransactionType, LIST_LIMIT_NUMBER, LOCAL_NATIONALITY, MAX_LIST_LIMIT_NUMBER, PAYGATE_ENCRYPTION_KEY, PAYGATE_ID, SERVICE_URLS, transactionType, LOCAL_CURRENCY, DEFAULT_LANG, DEFAULT_PAYMENT_EMAIL, LOCALY_COUNTRY_ALPHA_3_CODE } from "../globals";
import bidService from "./bid-service";
import * as luxon from "luxon";
import { generatePayGatePaymentURL, prefixWithZero, convertToPaygateFormat } from "../shared/functions";
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
    const auction = await auctionService.getById(item.auctionId, { participationType: 1, isInviteOnly: 1, invitedBidders: 1 });

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

    // Create payment transaction
    const paymentInput: ITransactionInput = {
      auctionId: item.auctionId,
      currency: LOCAL_CURRENCY,
      transactionType: 'RESERVATION',
      itemId: item.id,
      amount: item.reservePrice,
      buyerId: currentUser.id,
      sellerId: item.sellerId,
      metadata: {}
    };

    const newReservation = new Transaction(paymentInput);

    // Save transaction
    const savedReservation = await newReservation.save();

    // Generate payment link using PayGate
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedReservation.id.toString(), item.reservePrice, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/api/open/paygateReturn`, savedReservation.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/api/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

    const queryResponse = await fetch(`${SERVICE_URLS.paygateBaseURI}/initiate.trans`, {
      method: "POST",
      body: formattedString,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    if (!queryResponse.ok) {
      throw new InternalServerError(`Failed to create payment link: ${queryResponse.status}`);
    }

    const textReponse = await queryResponse.text();
    const paygateInitParams = new URLSearchParams(textReponse);

    (savedReservation.metadata as Map<string, string>).set('paymentLink', generatePayGatePaymentURL(textReponse));

    const payRequestId = paygateInitParams.get('PAY_REQUEST_ID');
    if (payRequestId) {
      (savedReservation.metadata as Map<string, string>).set('PAY_REQUEST_ID', payRequestId);
    }

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

    // Check if the bidder is the winner
    if (!item.winningBidder) {
      throw new InternalServerError('Winning bidder not found');
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
      const purchase = await Transaction.findOne({ buyerId: item.winningBidder, auctionId: auction._id, transactionType: "PURCHASE" }, { _id: 1 });
      if (purchase) {
        amount = winningBid.bidAmount;
      } else {
        amount = winningBid.bidAmount - item.reservePrice;
      }
    } else {
      amount = winningBid.bidAmount - item.reservePrice;
    }

    // Create payment transaction
    const paymentInput: ITransactionInput = {
      auctionId: item.auctionId,
      currency: LOCAL_CURRENCY,
      transactionType: 'PURCHASE',
      itemId: item.id,
      amount,
      buyerId: currentUser.id,
      sellerId: item.sellerId,
      relatedTransaction: reservation._id,
      metadata: {}
    };

    const newPurchase = new Transaction(paymentInput);

    // Save payment transaction
    const savedPurchase = await newPurchase.save();

    // Generate payment link using PayGate
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedPurchase.id.toString(), savedPurchase.amount, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/api/open/paygateReturn`, savedPurchase.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/api/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

    const queryResponse = await fetch(`${SERVICE_URLS.paygateBaseURI}/initiate.trans`, {
      method: "POST",
      body: formattedString,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    if (!queryResponse.ok) {
      throw new InternalServerError(`Failed to create payment link: ${queryResponse.status}`);
    }

    const textReponse = await queryResponse.text();
    const paygateInitParams = new URLSearchParams(textReponse);

    (savedPurchase.metadata as Map<string, string>).set('paymentLink', generatePayGatePaymentURL(textReponse));

    const payRequestId = paygateInitParams.get('PAY_REQUEST_ID');
    if (payRequestId) {
      (savedPurchase.metadata as Map<string, string>).set('PAY_REQUEST_ID', payRequestId);
    }

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
    const formattedString = convertToPaygateFormat(PAYGATE_ID, savedPurchase.id.toString(), item.buyoutPrice, LOCAL_CURRENCY, `${SERVICE_URLS.auctionsGovServerBaseURI}/api/open/paygateReturn`, savedPurchase.createdDate, DEFAULT_LANG, LOCALY_COUNTRY_ALPHA_3_CODE, DEFAULT_PAYMENT_EMAIL, `${SERVICE_URLS.auctionsGovServerBaseURI}/api/open/processSuccessfulPaymentFromPayGate`, PAYGATE_ENCRYPTION_KEY);

    const queryResponse = await fetch(`${SERVICE_URLS.paygateBaseURI}/initiate.trans`, {
      method: "POST",
      body: formattedString,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    if (!queryResponse.ok) {
      throw new InternalServerError(`Failed to create payment link: ${queryResponse.status}`);
    }

    const textReponse = await queryResponse.text();
    const paygateInitParams = new URLSearchParams(textReponse);

    (savedPurchase.metadata as Map<string, string>).set('paymentLink', generatePayGatePaymentURL(textReponse));

    const payRequestId = paygateInitParams.get('PAY_REQUEST_ID');
    if (payRequestId) {
      (savedPurchase.metadata as Map<string, string>).set('PAY_REQUEST_ID', payRequestId);
    }

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
    const transaction = await Transaction.findOne({ transactionType: input.transactionType, itemId: input.itemId, buyerId: currentUser._id, status: EPaymentStatus.COMPLETED }, { _id: 1 });

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

      if (item.eligibleBidders.indexOf(stringBuyerId) === -1) {
        item.eligibleBidders.push(stringBuyerId);
      }

      if (forum.participants.indexOf(stringBuyerId) === -1) {
        forum.participants.push(stringBuyerId);
      }

      const auction = await auctionService.getById(item.auctionId);
      if (!auction) {
        throw new NotFoundError('Auction not found');
      }

      if (auction.hasRegistrationFee) {
        if (auction.globallyEligibleBidders.indexOf(stringBuyerId) === -1) {
          auction.globallyEligibleBidders.push(stringBuyerId);
        }
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
      } else if (auction.hasRegistrationFee) {
        await auction.save({ session: sess });
      }

      await forum.save({ session: sess });
      await item.save({ session: sess });
      await transaction.save({ session: sess });

    } else if (transaction.transactionType === 'PURCHASE') {
      item.isPurchased = true;
      await sess.withTransaction(async () => {
        await transaction.save({ session: sess });
        await item.save({ session: sess });
      });

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
 * This function updates transactions of type `RESERVATION` or `PURCHASE`
 * that were created at least 15 minutes ago and are still in the `PENDING` state,
 * marking them as `FAILED`.
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
  initiateNonWinnerReservationRefunds
} as const;