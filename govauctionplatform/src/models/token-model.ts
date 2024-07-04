import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IToken extends Document {
  value: string;
  apiKey: string;
  isActive: boolean;
}

const schema = new Schema<IToken>({
  value: { type: String, required: true, trim: true },
  apiKey: { type: String, required: true, trim: true },
  isActive: { type: Boolean, required: true, default: true }
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

export const Token = model(EModels.TOKEN, schema);