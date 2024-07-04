import { Schema, model, Document } from 'mongoose';
import { EModels, EPaymentStatus, ETransactionType, paymentStatus, transactionType } from '../globals';

export interface ITransaction extends Document {
  itemId: Schema.Types.ObjectId;
  buyerId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  currency: string;
  amount: number;
  paymentMethod?: string;
  status: paymentStatus;
  relatedTransaction?: Schema.Types.ObjectId;
  externalReference?: string;
  metadata: any;
  transactionType: transactionType;
  createdDate: any;
}

export interface ITransactionInput {
  itemId: Schema.Types.ObjectId;
  currency: string;
  buyerId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  amount: number;
  metadata?: any;
  transactionType: transactionType;
  relatedTransaction?: Schema.Types.ObjectId;
}

export interface IUpdateTransactionInput {
  status?: paymentStatus;
  externalReference?: string;
}

const schema = new Schema<ITransaction>({
  itemId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ITEM },
  buyerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.BIDDER },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  amount: { type: Number, required: true },
  paymentMethod: { type: String, trim: true },
  metadata: { type: Map },
  currency: { type: String, trim: true, required: true },
  status: { type: String, default: EPaymentStatus.PENDING, enum: [EPaymentStatus.COMPLETED, EPaymentStatus.FAILED, EPaymentStatus.PENDING]},
  relatedTransaction: { type: Schema.Types.ObjectId, ref: EModels.TRANSACTION },
  externalReference: { type: String, trim: true },
  transactionType: { type: String, required: true, enum: [ETransactionType.PURCHASE, ETransactionType.REFUND, ETransactionType.RESERVATION] }
}, {
  timestamps: {
    createdAt: "createdDate"
  }
});

schema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__t;
  }
});

export const Transaction = model(EModels.TRANSACTION, schema);