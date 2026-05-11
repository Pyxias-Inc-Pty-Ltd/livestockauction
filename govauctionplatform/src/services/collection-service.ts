import { Schema, startSession, ClientSession } from 'mongoose';
import { createHash, randomInt } from 'crypto';
import { ForbiddenError, NotFoundError } from '../shared/errors';
import { isMongoId } from 'validator';
import { collectionOtpEmailTemplate, ECollectionStatus, EPushMessageReason, ERefundReason, ID_VERIFICATION_API_KEY, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER, ESortOrderType, SERVICE_URLS } from '../globals';
import { Collection, ICollection, ICollectionInput } from '../models/collection-model';
import { Bidder, IAdmin, IBidder, ISeller, IUser } from '../models/user-model';
import { IItem } from '../models/item-model';
import auctionService from './auction-service';
import itemService from './item-service';
import { IAuction } from '../models/auction-model';
import { firebase } from '../index';
import * as axios from 'axios';

/**
 * Adds the specified number of working days (Mon–Fri) to a date.
 */
function addWorkingDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added++;
    }
  }
  return result;
}

/**
 * Hash an OTP code bound to an itemId so it cannot be reused across items.
 */
function hashOtp(code: string, itemId: string): string {
  return createHash('sha256').update(`${code}:${itemId}`).digest('hex');
}

/**
 * Generate a cryptographically random 8-digit numeric OTP.
 */
function generateOtpCode(): string {
  return randomInt(10000000, 99999999).toString();
}

/**
 * Create a collection record after a PURCHASE transaction is completed.
 * Returns the plain OTP code once — callers must deliver it to the buyer.
 *
 * @param itemId
 * @param purchaseTransactionId
 * @returns { collection, otpCode } — otpCode must be forwarded to the buyer
 */
async function createCollection(
  itemId: string | Schema.Types.ObjectId,
  purchaseTransactionId: string | Schema.Types.ObjectId
): Promise<{ collection: ICollection; otpCode: string }> {
  const item = await itemService.getById(itemId, {
    auctionId: 1,
    sellerId: 1,
    winningBidder: 1,
    title: 1
  });

  if (!item) {
    throw new NotFoundError('Item not found');
  }

  const auction = await auctionService.getById(item.auctionId, {
    collectionWindowDays: 1,
    collectionStartTime: 1,
    collectionEndTime: 1
  });

  if (!auction) {
    throw new NotFoundError('Auction not found');
  }

  const otpCode = generateOtpCode();
  const otpCodeHash = hashOtp(otpCode, item._id.toString());

  // Deadline = end of the last collection day (using collectionEndTime)
  const [endHour, endMinute] = auction.collectionEndTime.split(':').map(Number);
  const deadline = addWorkingDays(new Date(), auction.collectionWindowDays);
  deadline.setHours(endHour, endMinute, 0, 0);

  const input: ICollectionInput = {
    itemId: item._id,
    auctionId: item.auctionId,
    buyerId: item.winningBidder as Schema.Types.ObjectId,
    sellerId: item.sellerId,
    purchaseTransactionId: purchaseTransactionId as Schema.Types.ObjectId,
    otpCodeHash,
    collectionDeadline: deadline
  };

  const collection = new Collection(input);
  await collection.save();

  // Deliver the OTP to the buyer — fire-and-forget so delivery failure
  // does not surface as a payment processing error.
  sendCollectionOtp(item, auction, otpCode, deadline).catch((err: Error) => {
    console.error(
      `[collection-service] Failed to deliver OTP for item ${item._id.toString()}: ${err.message}`
    );
  });

  return { collection, otpCode };
}

/**
 * Send the OTP code to the buyer via email and Firebase push notification.
 */
async function sendCollectionOtp(
  item: IItem,
  auction: IAuction,
  otpCode: string,
  deadline: Date
): Promise<void> {
  const buyer = await Bidder.findById(item.winningBidder, {
    email: 1,
    firstName: 1,
    name: 1,
    isOrganization: 1,
    firebaseTokenId: 1
  });

  if (!buyer) {
    console.warn('[collection-service] Buyer not found for OTP delivery');
    return;
  }

  const buyerName = (buyer as IBidder).isOrganization
    ? (buyer as IBidder).name as string
    : (buyer as IBidder).firstName as string;

  const deadlineStr = deadline.toLocaleDateString('en-BW', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const htmlContent = collectionOtpEmailTemplate
    .replace('[UserName]', buyerName)
    .replace('[ItemName]', (item as any).title?.en ?? item._id.toString())
    .replace('[OtpCode]', otpCode)
    .replace('[Deadline]', deadlineStr)
    .replace('[StartTime]', auction.collectionStartTime)
    .replace('[EndTime]', auction.collectionEndTime);

  // Queue email
  await axios.default.post(
    `${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`,
    {
      data: {
        subject: 'Your Collection Code',
        email: (buyer as IBidder).email,
        message: htmlContent
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ID_VERIFICATION_API_KEY
      }
    }
  );

  // Push notification
  const firebaseTokenId = (buyer as IBidder).firebaseTokenId;
  if (firebaseTokenId) {
    await firebase.messaging().send({
      data: { pmr: EPushMessageReason.NOTIFY_BUYER_OF_COLLECTION_OTP },
      notification: {
        title: 'Your Collection Code',
        body: `Your collection code for "${(item as any).title?.en}" is ${otpCode}. Collect by ${deadlineStr}.`
      },
      token: firebaseTokenId
    });
  }
}

/**
 * Validate the buyer's OTP code at pickup.
 * Can be called by a seller or any admin.
 * On success, status transitions to COLLECTED.
 *
 * @param currentUser
 * @param input
 */
async function validateCollectionCode(
  currentUser: IUser,
  input: { itemId: string; otpCode: string }
): Promise<ICollection> {
  const collection = await Collection.findOne({ itemId: input.itemId });

  if (!collection) {
    throw new NotFoundError('Collection record not found');
  }

  if (collection.status !== ECollectionStatus.AWAITING_COLLECTION) {
    throw new ForbiddenError(`Collection is already in status: ${collection.status}`);
  }

  const expectedHash = hashOtp(input.otpCode, input.itemId);

  if (expectedHash !== collection.otpCodeHash) {
    throw new ForbiddenError('Invalid collection code');
  }

  collection.status = ECollectionStatus.COLLECTED;
  collection.collectedAt = new Date();

  return await collection.save();
}

/**
 * Raise a dispute against a collection.
 * Can be raised by the seller or any admin.
 * Allowed from AWAITING_COLLECTION or COLLECTED status.
 *
 * @param currentUser
 * @param input
 */
async function raiseDispute(
  currentUser: IUser,
  input: { collectionId: string; reason: string }
): Promise<ICollection> {
  if (!isMongoId(input.collectionId)) {
    throw new NotFoundError('Collection not found');
  }

  const collection = await Collection.findById(input.collectionId);

  if (!collection) {
    throw new NotFoundError('Collection not found');
  }

  if (
    collection.status !== ECollectionStatus.AWAITING_COLLECTION &&
    collection.status !== ECollectionStatus.COLLECTED
  ) {
    throw new ForbiddenError(`Cannot raise a dispute from status: ${collection.status}`);
  }

  collection.status = ECollectionStatus.DISPUTED;
  collection.disputeReason = input.reason;
  collection.disputeRaisedBy = currentUser._id;

  return await collection.save();
}

/**
 * Resolve a disputed collection (admin only).
 * On resolution a REFUND transaction is created via the transaction service.
 * Status transitions to RESOLVED.
 *
 * @param currentUser
 * @param input
 * @param refundTransactionId — optional, provided after the refund is initiated externally
 */
async function resolveDispute(
  currentUser: IAdmin,
  input: { collectionId: string; refundTransactionId?: string }
): Promise<ICollection> {
  if (!isMongoId(input.collectionId)) {
    throw new NotFoundError('Collection not found');
  }

  const collection = await Collection.findById(input.collectionId);

  if (!collection) {
    throw new NotFoundError('Collection not found');
  }

  if (collection.status !== ECollectionStatus.DISPUTED) {
    throw new ForbiddenError(`Can only resolve DISPUTED collections, current status: ${collection.status}`);
  }

  collection.status = ECollectionStatus.RESOLVED;
  collection.refundReason = ERefundReason.DISPUTE_RESOLVED;

  if (input.refundTransactionId && isMongoId(input.refundTransactionId)) {
    collection.refundTransactionId = input.refundTransactionId as any;
  }

  return await collection.save();
}

/**
 * Get a collection record by item ID.
 */
async function getByItemId(itemId: string): Promise<ICollection | null> {
  if (!isMongoId(itemId)) {
    return null;
  }
  return await Collection.findOne({ itemId });
}

/**
 * Get a collection record by ID.
 */
async function getById(id: string): Promise<ICollection | null> {
  if (!isMongoId(id)) {
    return null;
  }
  return await Collection.findById(id);
}

/**
 * List collections with cursor-based pagination.
 */
async function getCollections(conditions: Map<string, any>): Promise<ICollection[]> {
  let _limit: number = LIST_LIMIT_NUMBER;

  if (conditions.get('limit') && conditions.get('limit') >= 1) {
    if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
      throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
    }
    _limit = conditions.get('limit');
  }

  const q = Collection.find();

  if (conditions.get('itemId')) {
    q.where({ itemId: conditions.get('itemId') });
  }

  if (conditions.get('buyerId')) {
    q.where({ buyerId: conditions.get('buyerId') });
  }

  if (conditions.get('sellerId')) {
    q.where({ sellerId: conditions.get('sellerId') });
  }

  if (conditions.get('auctionId')) {
    q.where({ auctionId: conditions.get('auctionId') });
  }

  if (conditions.get('status')) {
    q.where({ status: conditions.get('status') });
  }

  q.sort({ _id: conditions.get('sortOrder') || ESortOrderType.DESC });

  if (conditions.get('lastDocumentId')) {
    const sortOrder = conditions.get('sortOrder');
    if (sortOrder === ESortOrderType.ASC || sortOrder === ESortOrderType.asc) {
      q.where('_id').gt(conditions.get('lastDocumentId'));
    } else {
      q.where('_id').lt(conditions.get('lastDocumentId'));
    }
  }

  q.limit(_limit);
  q.populate('itemId', 'title');
  q.populate('buyerId', 'name firstName lastName email phone');

  return await q;
}

/**
 * Cron job: transition AWAITING_COLLECTION records past their deadline to FORFEITED.
 * Called by the open-router webhook endpoint on a schedule.
 */
async function trackCollectionStatus(): Promise<void> {
  let sess: ClientSession | null = null;

  try {
    sess = await startSession();

    await sess.withTransaction(async () => {
      const overdueCollections = await Collection.find({
        status: ECollectionStatus.AWAITING_COLLECTION,
        collectionDeadline: { $lt: new Date() }
      }).session(sess);

      const forfeitPromises = overdueCollections.map((col) => {
        col.status = ECollectionStatus.FORFEITED;
        return col.save({ session: sess });
      });

      await Promise.all(forfeitPromises);

      if (overdueCollections.length > 0) {
        console.info(
          `[collection-service] Forfeited ${overdueCollections.length} overdue collection(s)`
        );
      }
    });
  } catch (error) {
    console.error('[collection-service] Error in trackCollectionStatus:', error);
    throw error;
  } finally {
    if (sess) {
      await sess.endSession();
    }
  }
}

/**
 * Get the buyer's own collection for an item.
 * Only returns the collection if the requesting bidder is the buyer.
 */
async function getMyCollection(currentUser: IBidder, itemId: string): Promise<ICollection | null> {
  if (!isMongoId(itemId)) {
    return null;
  }

  const collection = await Collection.findOne({ itemId });

  if (!collection) {
    return null;
  }

  if (collection.buyerId.toString() !== currentUser.id.toString()) {
    throw new ForbiddenError('Not authorized to view this collection');
  }

  return collection;
}

/**
 * Resend the collection OTP to the buyer.
 * Generates a new code, updates the stored hash, and re-sends via email + push.
 * Only allowed while status is AWAITING_COLLECTION.
 */
async function resendCollectionOtp(currentUser: IBidder, itemId: string): Promise<void> {
  if (!isMongoId(itemId)) {
    throw new NotFoundError('Collection not found');
  }

  const collection = await Collection.findOne({ itemId });

  if (!collection) {
    throw new NotFoundError('Collection not found');
  }

  if (collection.buyerId.toString() !== currentUser.id.toString()) {
    throw new ForbiddenError('Not authorized');
  }

  if (collection.status !== ECollectionStatus.AWAITING_COLLECTION) {
    throw new ForbiddenError(`Cannot resend OTP for collection in status: ${collection.status}`);
  }

  const newOtp = generateOtpCode();
  collection.otpCodeHash = hashOtp(newOtp, itemId);
  await collection.save();

  const item = await itemService.getById(itemId, { auctionId: 1, sellerId: 1, winningBidder: 1, title: 1 });
  if (!item) {
    throw new NotFoundError('Item not found');
  }

  const auction = await auctionService.getById(item.auctionId, {
    collectionStartTime: 1,
    collectionEndTime: 1
  });
  if (!auction) {
    throw new NotFoundError('Auction not found');
  }

  await sendCollectionOtp(item, auction, newOtp, collection.collectionDeadline);
}

export default {
  createCollection,
  validateCollectionCode,
  raiseDispute,
  resolveDispute,
  getByItemId,
  getById,
  getCollections,
  trackCollectionStatus,
  getMyCollection,
  resendCollectionOtp
};
