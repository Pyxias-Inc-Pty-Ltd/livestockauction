import { ConflictError } from '../shared/errors';
import { Schema, model, Document } from 'mongoose';
import { itemStatus, EModels, EItemStatus } from '../globals';
import { generateSlug } from '../shared/functions';
import { uniqBy } from 'lodash';

export interface IItem extends Document {
  creatorId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  gallery: Array<string>;
  title: string;
  description: string;
  terms: string;
  startingBid: number;
  bidIncrement: number;
  reservePrice: number;
  eligibleBidders: Array<string>;
  winningBidder?: Schema.Types.ObjectId;
  currentBid?: number;
  titleSlug: string;
  buyoutPrice?: number;
  startTime: Date;
  endTime: Date;
  status: itemStatus;
  createdDate: any;
  updatedDate: any;
}

export interface IItemInput {
  gallery: Array<string>;
  creatorId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  title: string;
  description: string;
  terms: string;
  startingBid: number;
  status: itemStatus;
  bidIncrement: number;
  reservePrice: number;
  startTime: Date;
  endTime: Date;
}

export interface IUpdateItemInput {
  gallery?: Array<string>;
  currentBid?: number;
  auctionId?: Schema.Types.ObjectId;
  categoryId?: Schema.Types.ObjectId;
  buyoutPrice?: number;
  winningBidder?: Schema.Types.ObjectId;
  eligibleBidders?: Array<string>;
  status?: itemStatus;
}

const schema = new Schema<IItem>({
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  auctionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  winningBidder: { type: Schema.Types.ObjectId, ref: EModels.BIDDER },
  title: { type: String, required: true, trim: true },
  titleSlug: {type: String, trim: true, sparse: true, unique: true},
  description: { type: String, required: true, trim: true },
  terms: { type: String, required: true, trim: true },
  startingBid: { type: Number, required: true },
  bidIncrement: { type: Number, required: true },
  reservePrice: { type: Number, required: true },
  currentBid: { type: Number },
  buyoutPrice: { type: Number },
  gallery: { type: [String], required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: [EItemStatus.NOT_BEGUN, EItemStatus.ACTIVE, EItemStatus.CANCELLED, EItemStatus.ENDED]},
  eligibleBidders: [String]
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

schema.pre('save', async function () {
  const doc = this;

  if (doc.isNew || doc.isModified('title')) {
    doc.titleSlug = generateSlug(doc.title);
  }

  // Check if empty
  if (doc.eligibleBidders && doc.eligibleBidders.length > 0) {
    doc.eligibleBidders = uniqBy(doc.eligibleBidders, (e) => {
      return e.toString();
    });
  }
});

schema.post('save', function(error: any, doc: any, next: any) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    if (error.message.includes('titleSlug_1')) {
      next(new ConflictError('An item with this title already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

export const Item = model(EModels.ITEM, schema);