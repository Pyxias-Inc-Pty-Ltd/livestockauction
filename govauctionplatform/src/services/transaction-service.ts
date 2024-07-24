import { IBidder } from "../models/user-model";
import { ForbiddenError, InternalServerError, NotFoundError } from "../shared/errors";
import { isMongoId } from "validator";
import { ClientSession, Schema, startSession } from 'mongoose';
import { ITransaction, Transaction, ITransactionInput } from "../models/transaction-model";
import itemService from "./item-service";
import { EPaymentStatus, ESortOrderType, ETransactionSortType, LIST_LIMIT_NUMBER, LOCAL_NATIONALITY, MAX_LIST_LIMIT_NUMBER, paymentProvider, SERVICE_URLS, TINGG_BILLING_SERVICE_ID, transactionType, UNIPAY_APP_AUTH_TOKEN } from "../globals";
import bidService from "./bid-service";
import * as luxon from "luxon";
import { formatPhoneTinggNumber, generateUniPayAppPaymentURL } from "../shared/functions";
import tokenService from "./token-service";
import auctionService from "./auction-service";
import forumService from "./forum-service";

/**
 * Intiates a reservation payment transaction for an item.
 * 
 * @param currentUser
 * @param input
 * @returns 
 */
async function initiateItemReservation(currentUser: IBidder, input: { itemId: string, paymentProvider: paymentProvider }): Promise<ITransaction> {
  try {

    const result = await Promise.all([itemService.getById(input.itemId, { reservePrice: 1, sellerId: 1, auctionId: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!result[0]) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!result[1]) {
      throw new NotFoundError('Token not found');
    }

    const item = result[0];
    const token = result[1];

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

    const now = luxon.DateTime.now().setZone(currentUser.tz);
    const endOfDate = now.endOf('day');

    // Create payment transaction
    const paymentInput: ITransactionInput = {
      currency: 'BWP',
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

    if (input.paymentProvider === 'CELLULANT') {

      // Generate payment link from tingg
      const queryResponse = await fetch(`${SERVICE_URLS.tinggCreatePaymentLinkURI}`, {
        method: "POST",
        body: JSON.stringify({
          "billingServiceID": TINGG_BILLING_SERVICE_ID,
          "accountNumber": savedReservation.id.toString(),
          "accountName": "Pyxias",
          "dueAmount": item.reservePrice,
          "paidAmount": 0,
          "deliveryChannel": "EMAIL",
          "countryCode": "BWA",
          "currencyCode": "BWP",
          "msisdn": formatPhoneTinggNumber(currentUser.phone),
          "dueDate": endOfDate.toMillis(),
          "email": currentUser.email
      }),
        headers: {
          "Authorization": `Bearer ${token.value}`,
          "apiKey": `${token.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      if (queryResponse.status !== 201) {
        if (queryResponse.ok === false) {
          if (queryResponse.status === 401) {
            const { message, statusCode } = await queryResponse.json();
            if (statusCode === 132) {
              throw new InternalServerError(message);
            } else {
              throw new InternalServerError(message);
            }
          } else {
            const { message } = await queryResponse.json();
            throw new InternalServerError(message);
          }
        } else {
          throw new InternalServerError('Failed to create payment link');
        }
      }

      const { data } = await queryResponse.json();

      (savedReservation.metadata as Map<string, string>).set('paymentLink', `https://billpay.tingg.africa/${data.billID}`);
      savedReservation.externalReference = data.uniqueHash;

    } else {

      // Generate payment link from UniPay
      const queryResponse = await fetch(`${SERVICE_URLS.unipayInitiatePaymentApplication}`, {
        method: "POST",
        body: JSON.stringify({
          "amount": item.reservePrice,
          "payload": JSON.stringify({
            "transactionId": savedReservation.id.toString()
          })
      }),
        headers: {
          "Authorization": `Bearer ${UNIPAY_APP_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (queryResponse.status !== 201) {
        if (queryResponse.ok === false) {
          const { message } = await queryResponse.json();
          throw new InternalServerError(message);
        } else {
          throw new InternalServerError('Failed to create payment link');
        }
      }

      const { application } = await queryResponse.json();

      (savedReservation.metadata as Map<string, string>).set('paymentLink', generateUniPayAppPaymentURL(application.id));

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
 * @returns 
 */
async function initiatePurchaseItemByWinningBidder(currentUser: IBidder, input: { itemId: string, paymentProvider: paymentProvider }): Promise<ITransaction> {
  try {

    const result = await Promise.all([itemService.getById(input.itemId, { reservePrice: 1, sellerId: 1, winningBidder: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!result[0]) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!result[1]) {
      throw new NotFoundError('Token not found');
    }

    const item = result[0];
    const token = result[1];

    // Check if the bidder is the winner
    if (!item.winningBidder) {
      throw new InternalServerError('Winning bidder not found');
    }

    if (item.winningBidder.toString() !== currentUser.id.toString()) {
      throw new InternalServerError('Not the winning bidder');
    }

    // Find reservation by item
    const reservation = await Transaction.findOne({ itemId: item._id }, { _id: 1 });

    // Check if exists
    if (!reservation) {
      throw new NotFoundError('Transaction not found');
    }

    const winningBid = await bidService.getWinningBid(input.itemId);

    // Check if exists
    if (!winningBid) {
      throw new NotFoundError('Bid not found');
    }

    const now = luxon.DateTime.now().setZone(currentUser.tz);
    const endOfDate = now.endOf('day');
    const amount = winningBid.bidAmount - item.reservePrice;

    // Create payment transaction
    const paymentInput: ITransactionInput = {
      currency: 'BWP',
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

    if (input.paymentProvider === 'CELLULANT') {

      // Generate payment link from tingg
      const queryResponse = await fetch(`${SERVICE_URLS.tinggCreatePaymentLinkURI}`, {
        method: "POST",
        body: JSON.stringify({
          "billingServiceID": TINGG_BILLING_SERVICE_ID,
          "accountNumber": savedPurchase.id.toString(),
          "accountName": "Pyxias",
          "dueAmount": amount,
          "paidAmount": 0,
          "deliveryChannel": "EMAIL",
          "countryCode": "BWA",
          "currencyCode": "BWP",
          "msisdn": formatPhoneTinggNumber(currentUser.phone),
          "dueDate": endOfDate.toMillis(),
          "email": currentUser.email
      }),
        headers: {
          "Authorization": `Bearer ${token.value}`,
          "apiKey": `${token.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      if (queryResponse.status !== 201) {
        if (queryResponse.ok === false) {
          if (queryResponse.status === 401) {
            const { message, statusCode } = await queryResponse.json();
            if (statusCode === 132) {
              throw new InternalServerError(message);
            } else {
              throw new InternalServerError(message);
            }
          } else {
            const { message } = await queryResponse.json();
            throw new InternalServerError(message);
          }
        } else {
          throw new InternalServerError('Failed to create payment link');
        }
      }

      const { data } = await queryResponse.json();

      (savedPurchase.metadata as Map<string, string>).set('paymentLink', `https://billpay.tingg.africa/${data.billID}`);
      savedPurchase.externalReference = data.uniqueHash;

    } else {

      // Generate payment link from UniPay
      const queryResponse = await fetch(`${SERVICE_URLS.unipayInitiatePaymentApplication}`, {
        method: "POST",
        body: JSON.stringify({
          "amount": amount,
          "payload": JSON.stringify({
            "transactionId": savedPurchase.id.toString()
          })
      }),
        headers: {
          "Authorization": `Bearer ${UNIPAY_APP_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (queryResponse.status !== 201) {
        if (queryResponse.ok === false) {
          const { message } = await queryResponse.json();
          throw new InternalServerError(message);
        } else {
          throw new InternalServerError('Failed to create payment link');
        }
      }

      const { application } = await queryResponse.json();

      (savedPurchase.metadata as Map<string, string>).set('paymentLink', generateUniPayAppPaymentURL(application.id));

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
 * @returns 
 */
async function initiatePurchaseItemUsingBuyoutPrice(currentUser: IBidder, input: { itemId: string, paymentProvider: paymentProvider }): Promise<ITransaction> {
  try {

    // TODO: Make sure bidder can not purchase once bidding has begun

    const result = await Promise.all([itemService.getById(input.itemId, { buyoutPrice: 1, sellerId: 1, auctionId: 1 }), tokenService.getActiveToken()]);

    // Check if exists
    if (!result[0]) {
      throw new NotFoundError('Item not found');
    }

    // Check if exists
    if (!result[1]) {
      throw new NotFoundError('Token not found');
    }

    const item = result[0];
    const token = result[1];

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
      currency: 'BWP',
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

    if (input.paymentProvider === 'CELLULANT') {
      // Generate payment link from tingg
      const queryResponse = await fetch(`${SERVICE_URLS.tinggCreatePaymentLinkURI}`, {
        method: "POST",
        body: JSON.stringify({
          "billingServiceID": TINGG_BILLING_SERVICE_ID,
          "accountNumber": savedPurchase.id.toString(),
          "accountName": "Pyxias",
          "dueAmount": item.buyoutPrice,
          "paidAmount": 0,
          "deliveryChannel": "EMAIL",
          "countryCode": "BWA",
          "currencyCode": "BWP",
          "msisdn": formatPhoneTinggNumber(currentUser.phone),
          "dueDate": endOfDate.toMillis(),
          "email": currentUser.email
      }),
        headers: {
          "Authorization": `Bearer ${token.value}`,
          "apiKey": `${token.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      if (queryResponse.status !== 201) {
        if (queryResponse.ok === false) {
          const bodyResponse = await queryResponse.json();
          throw new InternalServerError(bodyResponse.error);
        } else {
          throw new InternalServerError('Failed to create payment link');
        }
      }

      const { data } = await queryResponse.json();

      (savedPurchase.metadata as Map<string, string>).set('paymentLink', `https://billpay.tingg.africa/${data.billID}`);
      savedPurchase.externalReference = data.uniqueHash;
    } else {
      // Generate payment link from UniPay
      const queryResponse = await fetch(`${SERVICE_URLS.unipayInitiatePaymentApplication}`, {
        method: "POST",
        body: JSON.stringify({
          "amount": item.buyoutPrice,
          "payload": JSON.stringify({
            "transactionId": savedPurchase.id.toString()
          })
      }),
        headers: {
          "Authorization": `Bearer ${UNIPAY_APP_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (queryResponse.status !== 201) {
        if (queryResponse.ok === false) {
          const { message } = await queryResponse.json();
          throw new InternalServerError(message);
        } else {
          throw new InternalServerError('Failed to create payment link');
        }
      }

      const { application } = await queryResponse.json();

      (savedPurchase.metadata as Map<string, string>).set('paymentLink', generateUniPayAppPaymentURL(application.id));
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
 * @returns 
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
 * Process a successful payment from the tingg platform
 * 
 * @param input 
 */
async function processSuccessfulPaymentFromTingg (input: { accountNumber: string, paymentMethod: string }): Promise<ITransaction> {

  let sess: ClientSession | null = null;

  try {

    // Find transaction
    const transaction = await getById(input.accountNumber);

    // Check if exists
    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    // Start session and mongo acid transaction
    sess = await startSession();

    // Check transaction type
    if (transaction.transactionType === 'RESERVATION') {

      transaction.status = 'COMPLETED';
      transaction.paymentMethod = input.paymentMethod;

      // Find item
      const item = await itemService.getById(transaction.itemId);

      // Check if exists
      if (!item) {
        throw new NotFoundError('Item not found');
      }

      const forum = await forumService.getForumByAuctionId(item.auctionId);

      // Check if exists
      if (!forum) {
        throw new NotFoundError('Forum not found');
      }

      // Insert buyer into list of eligible bidders
      item.eligibleBidders.push(transaction.buyerId.toString());

      forum.participants.push(transaction.buyerId.toString());

      await sess.withTransaction(async () => {

        await forum.save({
          session: sess
        });

        await item.save({
          session: sess
        });
  
        await transaction.save({
          session: sess
        });
  
      });

    } else if (transaction.transactionType === 'PURCHASE') {

      transaction.status = 'COMPLETED';
      transaction.paymentMethod = input.paymentMethod;

      await sess.withTransaction(async () => {
        await transaction.save();
      });

    }

    return transaction;

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
 * Process a successful payment from the UniPay platform
 * 
 * @param input 
 */
async function processSuccessfulPaymentFromUniPay(input: { payload: string, transaction: { id: string, currency: string, amount: number } }): Promise<ITransaction> {

  let sess: ClientSession | null = null;

  try {

    const payload = JSON.parse(input.payload);
    const paymentMethod = 'UniPay';

    // Find transaction
    const transaction = await getById(payload.transactionId);

    // Check if exists
    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    // Start session and mongo acid transaction
    sess = await startSession();

    // Check transaction type
    if (transaction.transactionType === 'RESERVATION') {

      transaction.status = 'COMPLETED';
      transaction.paymentMethod = paymentMethod;
      transaction.externalReference = input.transaction.id;

      // Find item
      const item = await itemService.getById(transaction.itemId);

      // Check if exists
      if (!item) {
        throw new NotFoundError('Item not found');
      }

      // Insert buyer into list of eligible bidders
      item.eligibleBidders.push(transaction.buyerId.toString());

      await sess.withTransaction(async () => {

        await item.save({
          session: sess
        });
  
        await transaction.save({
          session: sess
        });
  
      });

    } else if (transaction.transactionType === 'PURCHASE') {

      transaction.status = 'COMPLETED';
      transaction.paymentMethod = paymentMethod;
      transaction.externalReference = input.transaction.id;

      await sess.withTransaction(async () => {
        await transaction.save();
      });

    }

    return transaction;

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
 * Get a transaction by id.
 * 
 * @param id 
 * @param projection
 * @returns 
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
 * @returns 
 */
async function getTransactions(conditions: Map<string, any>, projection?: any): Promise<ITransaction[]> {
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
    const q = Transaction.find({}, projection);

    // Filters
    if (conditions.get('itemId')) {
      q.where({itemId: conditions.get('itemId')});
    }

    if (conditions.get('buyerId')) {
      q.where({buyerId: conditions.get('buyerId')});
    }

    if (conditions.get('sellerId')) {
      q.where({sellerId: conditions.get('sellerId')});
    }

    if (conditions.get('status')) {
      q.where({status: conditions.get('status')});
    }

    if (conditions.get('transactionType')) {
      q.where({transactionType: conditions.get('transactionType')});
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
      if (conditions.get('sortBy') === ETransactionSortType.DATE) {
        q.sort({'_id': conditions.get('sortOrder')});
      }
      if (conditions.get('sortBy') === ETransactionSortType.AMOUNT) {
        q.sort({'amount': conditions.get('sortOrder')});
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

// Export default
export default {
  initiateItemReservation,
  pollPaidTransaction,
  processSuccessfulPaymentFromTingg,
  processSuccessfulPaymentFromUniPay,
  initiatePurchaseItemByWinningBidder,
  initiatePurchaseItemUsingBuyoutPrice,
  getTransactions,
  getById
} as const;