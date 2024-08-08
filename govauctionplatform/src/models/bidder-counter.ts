import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IBidderCounter extends Document {
  auctionId: Schema.Types.ObjectId;
  sequenceValue: number;
  createdDate: any;
  updatedDate: any;
}

const schema = new Schema<IBidderCounter>({
  auctionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
  sequenceValue: { type: Number, required: true, default: 0 }
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

export const BidderCounter = model(EModels.BIDDER_COUNTER, schema);