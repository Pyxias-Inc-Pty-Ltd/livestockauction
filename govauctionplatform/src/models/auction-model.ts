import { ConflictError } from '../shared/errors';
import { Schema, model, Document } from 'mongoose';
import { itemStatus, EModels, EAuctionStatus } from '../globals';
import { generateSlug } from '../shared/functions';

export interface IAuction extends Document {
  title: string;
  titleSlug: string;
  auctionNumber: string;
  auctionLocation: string;
  numberOfLots: number;
  creatorId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  terms: string;
  startTime: Date;
  endTime: Date;
  status: itemStatus;
  createdDate: any;
  updatedDate: any;
}

export interface IAuctionInput {
  title: string;
  auctionNumber: string;
  auctionLocation: string;
  creatorId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  terms: string;
  startTime: Date;
  endTime: Date;
}

export interface IUpdateAuctionInput {
  title?: string;
  auctionNumber?: string;
  auctionLocation?: string;
  numberOfLots?: number;
  categoryId?: Schema.Types.ObjectId;
  terms?: string;
  startTime?: Date;
  endTime?: Date;
  status?: itemStatus;
}

const schema = new Schema<IAuction>({
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  title: { type: String, required: true, trim: true },
  titleSlug: {type: String, trim: true, sparse: true, unique: true},
  auctionNumber: { type: String, trim: true, required: true },
  auctionLocation: { type: String, trim: true },
  numberOfLots: { type: Number, default: 0, min: 0, required: true },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
  terms: { type: String, required: true, trim: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: [EAuctionStatus.NOT_BEGUN, EAuctionStatus.ACTIVE, EAuctionStatus.CANCELLED, EAuctionStatus.ENDED]},
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
});

schema.post('save', function(error: any, doc: any, next: any) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    if (error.message.includes('titleSlug_1')) {
      next(new ConflictError('An auction with this title already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

export const Auction = model(EModels.AUCTION, schema);