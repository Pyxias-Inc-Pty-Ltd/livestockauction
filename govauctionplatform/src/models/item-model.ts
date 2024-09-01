import { ConflictError, InternalServerError, NotFoundError } from '../shared/errors';
import { Schema, model, Document } from 'mongoose';
import { itemStatus, EModels, EItemStatus, genderType, EGenderType } from '../globals';
import { generateSlug } from '../shared/functions';
import { uniqBy } from 'lodash';
import { ICategory } from './category-model';
import { IAuction } from './auction-model';

export interface IItem extends Document {
  creatorId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  gallery: Array<string>;
  isLivestock: boolean;
  isAStud: boolean;
  dob?: Date;
  studRegistrationNumber?: string;
  numberOfCalvesBorn?: number;
  gender?: genderType;
  breedId?: Schema.Types.ObjectId;
  title: string;
  description: string;
  terms: string;
  isBidIncrementedManually: boolean;
  manualBidAmount: number;
  startingBid: number;
  bidIncrement?: number;
  reservePrice: number;
  eligibleBidders: Array<string>;
  winningBidder?: Schema.Types.ObjectId;
  currentBid?: number;
  titleSlug: string;
  buyoutPrice?: number;
  startTime: Date;
  endTime: Date;
  version: number;
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
  isBidIncrementedManually?: boolean;
  manualBidAmount?: number;
  dob?: Date;
  isAStud: boolean;
  numberOfCalvesBorn?: number;
  studRegistrationNumber?: string;
  isLivestock: boolean;
  gender?: genderType;
  breedId?: Schema.Types.ObjectId;
  title: string;
  description: string;
  terms: string;
  startingBid: number;
  status: itemStatus;
  bidIncrement?: number;
  reservePrice: number;
  startTime: Date;
  endTime: Date;
}

const schema = new Schema<IItem>({
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  auctionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  winningBidder: { type: Schema.Types.ObjectId, ref: EModels.BIDDER },
  title: { type: String, required: true, trim: true },
  titleSlug: {type: String, trim: true},
  description: { type: String, required: true, trim: true },
  terms: { type: String, required: true, trim: true },
  startingBid: { type: Number, required: true },
  bidIncrement: { type: Number, required: function (): boolean {
    return !(this as IItem).isBidIncrementedManually;
  } },
  reservePrice: { type: Number, required: true },
  currentBid: { type: Number },
  buyoutPrice: { type: Number },
  manualBidAmount: { type: Number, default: 0 },
  isBidIncrementedManually: {type: Boolean, default: false},
  gallery: { type: [String], required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: [EItemStatus.NOT_BEGUN, EItemStatus.ACTIVE, EItemStatus.CANCELLED, EItemStatus.ENDED]},
  eligibleBidders: [String],
  isLivestock: { type: Boolean, default: true, required: true },
  gender: { type: String, enum: [EGenderType.FEMALE, EGenderType.MALE, EGenderType.MIXED], required: function (): boolean {
    return (this as IItem).isLivestock;
  } },
  breedId: { type: Schema.Types.ObjectId, ref: EModels.BREED, required: function (): boolean {
    return (this as IItem).isLivestock;
  } },
  isAStud: { type: Boolean, default: false, required: function (): boolean {
    return (this as IItem).isLivestock;
  } },
  studRegistrationNumber: { type: String, trim: true , required: function (): boolean {
    return (this as IItem).isAStud;
  } },
  numberOfCalvesBorn: { type: Number, min: 0 },
  dob: {type: Date, required: function (): boolean {
    return (this as IItem).gender !== undefined && (this as IItem).gender !== 'MIXED';
  }},
  version: { type: Number, default: 0 }
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

schema.index({ titleSlug: 1, _id: 1 }, { unique: true });

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

  if (doc.isNew) {
    const auction = await doc.$model(EModels.AUCTION).findById({auction: doc.auctionId}, {globallyEligibleBidders: 1}) as IAuction | null;

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    doc.eligibleBidders = auction.globallyEligibleBidders;
  }

  if (doc.isNew || doc.isModified('title')) {
    doc.titleSlug = generateSlug(doc.title);
  }

  if (doc.isNew || doc.isModified('gender') || doc.isModified('isLivestock')) {
    if (doc.isLivestock && doc.gender === 'FEMALE') {
      const category = await doc.$model(EModels.CATEGORY).findById({phone: doc.categoryId}, {nameSlug: 1}) as ICategory | null;

      // Check if exists
      if (!category) {
        throw new NotFoundError('Category not found');
      }

      if (category.nameSlug === 'cattle') {
        if (typeof doc.numberOfCalvesBorn !== 'number') {
          throw new InternalServerError(`Property 'numberOfCalvesBorn' must be defined`);
        }
      }
    }
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
    if (error.message.includes('titleSlug_1__id_1')) {
      next(new ConflictError('An item with this title already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

export const Item = model(EModels.ITEM, schema);