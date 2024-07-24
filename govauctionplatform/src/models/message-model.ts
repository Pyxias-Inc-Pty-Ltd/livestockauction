import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IMessage extends Document {
  adminId: Schema.Types.ObjectId;
  bidderId: Schema.Types.ObjectId;
  authorId: Schema.Types.ObjectId;
  content: string;
  createdDate: any;
}

export interface IMessageInput {
  authorId: Schema.Types.ObjectId;
  chatId: Schema.Types.ObjectId;
  content: string;
}

const messageSchema = new Schema<IMessage>({
  adminId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  bidderId: { type: Schema.Types.ObjectId, required: true, ref: EModels.BIDDER },
  authorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
  content: { type: String, required: true, trim: true }
}, {
  timestamps: {
    createdAt: "createdDate"
  }
});

messageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__t;
  }
});

export const Message = model(EModels.MESSAGE, messageSchema);