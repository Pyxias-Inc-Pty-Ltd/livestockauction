import { Schema, model, Document } from 'mongoose';
import { EModels, EPaymentStatus, ETransactionType, paymentStatus, transactionType } from '../globals';
import { firebase } from '../index';
import { NotFoundError } from '../shared/errors';
import { IUser } from './user-model';
import { IItem } from './item-model';

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
  status: { type: String, default: EPaymentStatus.PENDING, enum: [EPaymentStatus.COMPLETED, EPaymentStatus.FAILED, EPaymentStatus.PENDING] },
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

// Post-save hook for transaction schema
schema.post('save', async function (doc) {
  try {
    if (doc.status === EPaymentStatus.COMPLETED) {
      const [ buyer, item ] = await Promise.all([doc.$model(EModels.USER).findById(doc.buyerId, { firebaseTokenId: 1 }), doc.$model(EModels.ITEM).findById(doc.itemId, { title: 1 })]);

      if (!buyer) {
        throw new NotFoundError('User not found');
      }

      if (!item) {
        throw new NotFoundError('Item not found');
      }

      const token = (buyer as IUser).firebaseTokenId;

      let body = "";

      if (doc.transactionType === "RESERVATION") {
        body = `Your payment for reservation of "${(item as IItem).title}" has been completed successfully.`;
      } else if (doc.transactionType === "PURCHASE") {
        body = `Your payment for purchase of "${(item as IItem).title}" has been completed successfully.`;
      } else { // Assumes REFUND
        body = `Your refund for "${(item as IItem).title}" has been completed successfully.`;
      }

      // Construct message
      const message = {
        notification: {
          title: 'Transaction Completed',
          body
        },
        token: token
      };

      // Send notification
      if (token) {
        const response = await firebase.messaging().send(message);
        console.log('Successfully sent notification:', response);
      } else {
        console.log('No token available to send notification.');
      }
    } else if (doc.status === EPaymentStatus.FAILED) {
      const [ buyer, item ] = await Promise.all([doc.$model(EModels.USER).findById(doc.buyerId, { firebaseTokenId: 1 }), doc.$model(EModels.ITEM).findById(doc.itemId, { title: 1 })]);

      if (!buyer) {
        throw new NotFoundError('User not found');
      }

      if (!item) {
        throw new NotFoundError('Item not found');
      }

      const token = (buyer as IUser).firebaseTokenId;

      let body = "";

      if (doc.transactionType === "RESERVATION") {
        body = `Your payment for reservation of "${(item as IItem).title}" has failed.`;
      } else if (doc.transactionType === "PURCHASE") {
        body = `Your payment for purchase of "${(item as IItem).title}" has failed.`;
      } else { // Assumes REFUND
        body = `Your refund for "${(item as IItem).title}" has failed.`;
      }

      // Construct message
      const message = {
        notification: {
          title: 'Transaction Completed',
          body
        },
        token: token
      };

      // Send notification
      if (token) {
        const response = await firebase.messaging().send(message);
        console.log('Successfully sent notification:', response);
      } else {
        console.log('No token available to send notification.');
      }
    }
  } catch (error) {
    console.error('Error sending notification:', error);
  }
});

export const Transaction = model<ITransaction>(EModels.TRANSACTION, schema);
