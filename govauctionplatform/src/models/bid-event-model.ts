import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

/**
 * Every action that changes the state of a bid — placement, retraction,
 * or rejection — is recorded as an immutable BidEvent.
 *
 * This append-only log is the source of truth for legal disputes, audits,
 * and post-auction analysis.  Documents are NEVER updated or deleted.
 *
 * Event types:
 *   BID_PLACED   — a bid was successfully committed to the database.
 *   BID_RETRACTED — the bidder retracted their open-auction bid.
 *   BID_REJECTED — the bid was rejected by business logic (not eligible,
 *                  auction ended, amount too low, etc.) and was NOT saved
 *                  to the Bid collection.  Useful for detecting abuse.
 */
export type BidEventType = 'BID_PLACED' | 'BID_RETRACTED' | 'BID_REJECTED';

export interface IBidEvent extends Document {
  /** The type of event. */
  eventType: BidEventType;
  /** Item the bid was placed on. */
  itemId: Schema.Types.ObjectId;
  /** Auction the item belongs to — denormalised for query convenience. */
  auctionId: Schema.Types.ObjectId;
  /** Bidder who placed or retracted the bid. */
  userId: Schema.Types.ObjectId;
  /** The Bid document created by this event (absent for BID_REJECTED). */
  bidId?: Schema.Types.ObjectId;
  /** Amount submitted by the bidder. */
  bidAmount: number;
  /** Auction mode at the time of the event. */
  auctionMode: 'open' | 'livestream' | 'sealed';
  /** Reason for rejection (present only for BID_REJECTED events). */
  rejectionReason?: string;
  /**
   * Wall-clock timestamp of when the event was recorded.
   * Stored explicitly so it is part of the immutable document rather than
   * relying on a mutable `updatedAt` timestamp.
   */
  occurredAt: Date;
  /**
   * BullMQ job ID that triggered this event.
   * Useful for correlating events with queue metrics.
   */
  jobId?: string;
}

const schema = new Schema<IBidEvent>(
  {
    eventType:       { type: String, required: true, enum: ['BID_PLACED', 'BID_RETRACTED', 'BID_REJECTED'] },
    itemId:          { type: Schema.Types.ObjectId, required: true, ref: EModels.ITEM },
    auctionId:       { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
    userId:          { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
    bidId:           { type: Schema.Types.ObjectId, ref: EModels.BID },
    bidAmount:       { type: Number, required: true },
    auctionMode:     { type: String, required: true, enum: ['open', 'livestream', 'sealed'] },
    rejectionReason: { type: String },
    occurredAt:      { type: Date, required: true, default: () => new Date() },
    jobId:           { type: String },
  },
  {
    // createdAt is sufficient — no updatedAt because documents are immutable.
    timestamps: { createdAt: 'createdDate', updatedAt: false },
  },
);

// ── Immutability guard ────────────────────────────────────────────────────────
// Pre-hooks that block any attempt to update or delete documents.
// This is a defence-in-depth measure — application code should never update
// bid events, but this makes it structurally impossible.

schema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function () {
  throw new Error('BidEvent documents are immutable and cannot be updated');
});

schema.pre(['deleteOne', 'findOneAndDelete', 'deleteMany'], function () {
  throw new Error('BidEvent documents are immutable and cannot be deleted');
});

// ── Indexes ───────────────────────────────────────────────────────────────────
// Support common audit query patterns without over-indexing.

// Most common: "show me all events for item X" (post-auction audit)
schema.index({ itemId: 1, occurredAt: -1 });

// Admin: "show me all events for bidder Y across all auctions"
schema.index({ userId: 1, occurredAt: -1 });

// Operations: "show me all events for auction Z"
schema.index({ auctionId: 1, occurredAt: -1 });

schema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
  },
});

export const BidEvent = model<IBidEvent>(EModels.BID_EVENT, schema);
