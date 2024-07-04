import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IMessage extends Document {
  itemId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  message: string;
  createdDate: any;
}

export interface IMessageInput {
  itemId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  message: string;
}

const schema = new Schema<IMessage>({
  userId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
  itemId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ITEM },
  message: { type: String, required: true, trim: true }
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
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