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
  createdDate: any;
  updatedDate: any;
}

export interface IBidInput {
  itemId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  bidAmount: number;
  bidTime: Date;
}

const schema = new Schema<IBid>({
  userId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
  itemId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ITEM },
  isRetracted: { type: Boolean, default: false, required: true },
  bidAmount: { type: Number, required: true },
  bidTime: { type: Date, required: true },
  _bidNumber: { type: String } // Internal storage for the virtual, not exposed directly
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

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