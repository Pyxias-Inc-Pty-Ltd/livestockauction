import { Schema, model, Document } from 'mongoose';
import { EModels, EPaymentStatus, EPushMessageReason, ETransactionType, paymentStatus, purchasePaymentFailedTemplate, purchasePaymentTemplate, refundFailedTemplate, refundTemplate, reservePricePaymentFailedTemplate, reservePricePaymentTemplate, transactionType, VERIFIED_EMAIL } from '../globals';
import { firebase, sgMail } from '../index';
import { InternalServerError, NotFoundError } from '../shared/errors';
import { IItem } from './item-model';
import { IBidder } from './user-model';

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

schema.pre('save', async function(next) {
  if (!this.isNew && this.isModified('status')) {
    this.$locals.isPaymentStatusModified = true;
  } else {
    this.$locals.isPaymentStatusModified = false;
  }
  next();
});

// Post-save hook for transaction schema
schema.post('save', async function (doc) {
  try {
    if (this.$locals.isPaymentStatusModified) {
      const sess = doc.$session();
      if (!sess) {
        throw new InternalServerError('A mongodb session is required on the transaction-model post save hook');
      }

      const [buyer, item] = await Promise.all([
        doc.$model(EModels.USER).findById(doc.buyerId, { firebaseTokenId: 1 }).session(sess),
        doc.$model(EModels.ITEM).findById(doc.itemId, { title: 1 }).session(sess)
      ]);

      if (!buyer) {
        throw new NotFoundError('User not found');
      }

      if (!item) {
        throw new NotFoundError('Item not found');
      }

      const firebaseTokenId = (buyer as IBidder).firebaseTokenId;
      const email = (buyer as IBidder).email;
      let notificationTrigger = null;
      let notificationMessage = "";
      let pmr = "";
      let htmlContent = "";

      switch (doc.transactionType) {
        case "RESERVATION":
          pmr = doc.status === EPaymentStatus.COMPLETED ? EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_RESERVE_PRICE_PAYMENT : EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_RESERVE_PRICE_PAYMENT;
          notificationTrigger = await doc.$model(EModels.NOTIFICATION_TRIGGER).findOne({ name: doc.status === EPaymentStatus.COMPLETED ? EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_RESERVE_PRICE_PAYMENT : EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_RESERVE_PRICE_PAYMENT }, { _id: 1 }).session(sess);
          notificationMessage = `Your payment for reservation of "${(item as any).title}" has ${doc.status === EPaymentStatus.COMPLETED ? 'been completed successfully' : 'failed'}.`;
          htmlContent = doc.status === EPaymentStatus.COMPLETED ? reservePricePaymentTemplate.replace('[UserName]', (buyer as IBidder).firstName).replace('[ItemName]', (item as IItem).title) : reservePricePaymentFailedTemplate.replace('[UserName]', (buyer as IBidder).firstName).replace('[ItemName]', (item as IItem).title);
          break;
        case "PURCHASE":
          pmr = doc.status === EPaymentStatus.COMPLETED ? EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_PURCHASE_PAYMENT : EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_PURCHASE_PAYMENT;
          notificationTrigger = await doc.$model(EModels.NOTIFICATION_TRIGGER).findOne({ name: doc.status === EPaymentStatus.COMPLETED ? EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_PURCHASE_PAYMENT : EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_PURCHASE_PAYMENT }, { _id: 1 }).session(sess);
          notificationMessage = `Your payment for purchase of "${(item as any).title}" has ${doc.status === EPaymentStatus.COMPLETED ? 'been completed successfully' : 'failed'}.`;
          htmlContent = doc.status === EPaymentStatus.COMPLETED ? purchasePaymentTemplate.replace('[UserName]', (buyer as IBidder).firstName).replace('[ItemName]', (item as IItem).title) : purchasePaymentFailedTemplate.replace('[UserName]', (buyer as IBidder).firstName).replace('[ItemName]', (item as IItem).title);
          break;
        default: // Assumes REFUND
          pmr = doc.status === EPaymentStatus.COMPLETED ? EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_REFUND : EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_REFUND;
          notificationTrigger = await doc.$model(EModels.NOTIFICATION_TRIGGER).findOne({ name: doc.status === EPaymentStatus.COMPLETED ? EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_REFUND : EPushMessageReason.NOTIFY_USER_OF_UNSUCCESSFUL_REFUND }, { _id: 1 }).session(sess);
          notificationMessage = `Your refund for "${(item as any).title}" has ${doc.status === EPaymentStatus.COMPLETED ? 'been completed successfully' : 'failed'}.`;
          htmlContent = doc.status === EPaymentStatus.COMPLETED ? refundTemplate.replace('[UserName]', (buyer as IBidder).firstName).replace('[ItemName]', (item as IItem).title) : refundFailedTemplate.replace('[UserName]', (buyer as IBidder).firstName).replace('[ItemName]', (item as IItem).title);
          break;
      }

      if (!notificationTrigger) {
        throw new InternalServerError('Notification trigger not found');
      }

      // Create notification object
      const newNotificationObject = await doc.$model(EModels.NOTIFICATION_OBJECT).create([{
        trigger: notificationTrigger.id,
        entity: doc.id,
        onEntityModel: EModels.TRANSACTION
      }], { session: sess });

      // Create notification change
      await doc.$model(EModels.NOTIFICATION_CHANGE).create([{
        notificationObject: (newNotificationObject as any)._id,
        actor: buyer._id,
        onActorModel: EModels.USER
      }], { session: sess });

      // Create notification
      await doc.$model(EModels.NOTIFICATION).create([{
        notificationObject: (newNotificationObject as any)._id,
        notifier: buyer._id,
        onNotifierModel: EModels.USER,
        notificationMessage
      }], { session: sess });

      const title = `Transaction ${doc.status === EPaymentStatus.COMPLETED ? 'completed' : 'failed'}`;

      // Also send to email
      await sgMail.send({
        to: email,
        from: VERIFIED_EMAIL,
        subject: title,
        html: htmlContent
      });

      // Check for firebase token
      if (firebaseTokenId) {
        // Construct message
        const message = {
          data: {
            pmr
          },
          notification: {
            title,
            body: notificationMessage
          },
          token: firebaseTokenId
        };
        await firebase.messaging().send(message);
      }
    }
  } catch (error) {
    console.error('Error sending notification:', error);
  }
});

export const Transaction = model<ITransaction>(EModels.TRANSACTION, schema);
