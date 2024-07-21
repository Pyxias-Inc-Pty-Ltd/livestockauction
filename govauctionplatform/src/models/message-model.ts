import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IMessage extends Document {
  auctionId?: Schema.Types.ObjectId;
  senderId: Schema.Types.ObjectId;
  recipientId?: Schema.Types.ObjectId;
  isAGroupForum: boolean;
  content: string;
  isRead: boolean;
  createdDate: any;
}

export interface IMessageInput {
  itemId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  message: string;
}

const schema = new Schema<IMessage>({
  senderId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
  recipientId: { type: Schema.Types.ObjectId, required: function (): boolean {
    return !(this as IMessage).isAGroupForum;
  }, ref: EModels.USER },
  auctionId: { type: Schema.Types.ObjectId, required: function (): boolean {
    return (this as IMessage).isAGroupForum;
  }, ref: EModels.AUCTION },
  content: { type: String, required: true, trim: true },
  isRead: { type: Boolean, required: true, default: false },
  isAGroupForum: { type: Boolean, required: true, default: false }
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

export const Message = model(EModels.MESSAGE, schema);