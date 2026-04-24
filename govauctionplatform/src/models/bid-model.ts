import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IBid extends Document {
  itemId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  isRetracted: boolean;
  bidAmount: number;
  bidTime: Date;
  bidNumber: string;
  _bidNumber?: string; // For internal use
  /**
   * Client-generated UUID sent with every bid attempt.
   * The unique sparse index on this field rejects duplicate socket retransmissions
   * at the database level — the first write wins, all subsequent writes with the
   * same key are rejected before any business logic runs.
   */
  idempotencyKey?: string;
  /**
   * AES-256-GCM encrypted form of bidAmount, stored only for sealed (Mode 3)
   * bids.  While the auction is active, `bidAmount` is set to 0 on sealed bids
   * so competitors cannot infer the value from the DB.  At auction close,
   * `decryptSealedBids()` reads this field and restores `bidAmount`.
   *
   * Format: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
   */
  bidAmountEncrypted?: string;
  createdDate: any;
  updatedDate: any;
}

export interface IBidInput {
  itemId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  bidAmount: number;
  bidTime: Date;
  idempotencyKey?: string;
}

const schema = new Schema<IBid>({
  userId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
  itemId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ITEM },
  isRetracted: { type: Boolean, default: false, required: true },
  bidAmount: { type: Number, required: true },
  bidTime: { type: Date, required: true },
  // Sparse so bids without a key (legacy data) don't conflict with each other.
  idempotencyKey: { type: String, sparse: true },
  // Stored only for sealed bids; absent for open / livestream bids.
  bidAmountEncrypted: { type: String },
  _bidNumber: { type: String } // Internal storage for the virtual, not exposed directly
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

// Unique sparse index — enforces idempotency at the DB layer.
// Sparse means documents without idempotencyKey are excluded from the index
// so legacy bids and bids from clients that don't send the key are unaffected.
schema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

schema.virtual('bidNumber')
  .get(function() {
    return this._bidNumber;
  })
  .set(function(value: string) {
    this._bidNumber = value;
  });

schema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__t;
  }
});

export const Bid = model(EModels.BID, schema);