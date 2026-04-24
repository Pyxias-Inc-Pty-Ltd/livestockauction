import { Schema, model, Document } from 'mongoose';
import { ECollectionStatus, EModels, ERefundReason, collectionStatus, refundReason } from '../globals';

export interface ICollection extends Document {
  itemId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  buyerId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  purchaseTransactionId: Schema.Types.ObjectId;
  otpCodeHash: string;
  status: collectionStatus;
  collectionDeadline: Date;
  collectedAt?: Date;
  disputeReason?: string;
  disputeRaisedBy?: Schema.Types.ObjectId;
  refundReason?: refundReason;
  refundTransactionId?: Schema.Types.ObjectId;
  createdDate: Date;
  updatedDate: Date;
}

export interface ICollectionInput {
  itemId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  buyerId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  purchaseTransactionId: Schema.Types.ObjectId;
  otpCodeHash: string;
  collectionDeadline: Date;
}

const collectionSchema = new Schema<ICollection>({
  itemId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ITEM, unique: true },
  auctionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
  buyerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.BIDDER },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  purchaseTransactionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.TRANSACTION },
  otpCodeHash: { type: String, required: true },
  status: {
    type: String,
    required: true,
    enum: [
      ECollectionStatus.AWAITING_COLLECTION,
      ECollectionStatus.COLLECTED,
      ECollectionStatus.DISPUTED,
      ECollectionStatus.FORFEITED,
      ECollectionStatus.RESOLVED
    ],
    default: ECollectionStatus.AWAITING_COLLECTION
  },
  collectionDeadline: { type: Date, required: true },
  collectedAt: { type: Date },
  disputeReason: { type: String, trim: true },
  disputeRaisedBy: { type: Schema.Types.ObjectId, ref: EModels.USER },
  refundReason: { type: String, enum: [ERefundReason.NON_WINNER, ERefundReason.DISPUTE_RESOLVED] },
  refundTransactionId: { type: Schema.Types.ObjectId, ref: EModels.TRANSACTION }
}, {
  timestamps: {
    createdAt: 'createdDate',
    updatedAt: 'updatedDate'
  }
});

collectionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__t;
    delete ret.otpCodeHash; // Never expose the hash
  }
});

export const Collection = model<ICollection>(EModels.COLLECTION, collectionSchema);
