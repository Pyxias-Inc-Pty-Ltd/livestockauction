import { ConflictError, ForbiddenError } from '../shared/errors';
import { Schema, model, Document } from 'mongoose';
import { EModels, EAuctionStatus, participationType, EParticipationType, auctionStatus, ENVIRONMENT_PRODUCTION, publishedStatus, EPublishedStatus } from '../globals';
import { generateSlug } from '../shared/functions';
import { isURL } from 'validator';

export interface IRequiredAttribute extends Document {
  name: string;
  nameSlug: string;
  createdDate: any;
  updatedDate: any;
}

export interface IRequiredAttributeInput {
  name: string;
}

export interface IAuction extends Document {
  title: string;
  titleSlug: string;
  auctionNumber: string;
  auctionLocation: string;
  auctionCoordinates?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  numberOfLots: number;
  hasRegistrationFee: boolean;
  requiredAttributes: string[];
  registrationFee?: number;
  participantsWithBiddingNumbers: Array<string>;
  globallyEligibleBidders: Array<string>;
  creatorId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  participationType: participationType;
  terms: string;
  startTime: Date;
  endTime: Date;
  status: auctionStatus;
  publishedStatus: publishedStatus;
  reasonForRejection?: string;
  publishedBy?: Schema.Types.ObjectId;
  isBeingLivestreamed: boolean;
  streamUrl: string;
  createdDate: any;
  updatedDate: any;
}

export interface IAuctionInput {
  title: string;
  auctionNumber: string;
  hasRegistrationFee: boolean;
  registrationFee?: number;
  auctionLocation: string;
  participationType: participationType;
  creatorId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  publishedStatus?: publishedStatus;
  reasonForRejection?: string;
  publishedBy?: Schema.Types.ObjectId;
  terms: string;
  isBeingLivestreamed: boolean;
  streamUrl: string;
  startTime: Date;
  endTime: Date;
}

const requiredAttributeSchema = new Schema<IRequiredAttribute>({
  name: { type: String, required: true, trim: true },
  nameSlug: {type: String, trim: true, sparse: true, unique: true}
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

requiredAttributeSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__t;
  }
});

requiredAttributeSchema.pre('save', async function () {
  const doc = this;

  if (doc.isNew || doc.isModified('name')) {
    doc.nameSlug = generateSlug(doc.name);
  }
});

requiredAttributeSchema.post('save', function(error: any, doc: any, next: any) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    if (error.message.includes('nameSlug_1')) {
      next(new ConflictError('A required attribute with this name already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

const auctionSchema = new Schema<IAuction>({
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
  title: { type: String, required: true, trim: true },
  titleSlug: {type: String, trim: true, sparse: true, unique: true},
  auctionNumber: { type: String, trim: true, required: true },
  publishedStatus: { type: String, enum: EPublishedStatus, default: EPublishedStatus.UNPUBLISHED, required: true },
  reasonForRejection: { type: String, required: function(): boolean {
    return (this as IAuction).publishedStatus === EPublishedStatus.REJECTED;
  }, trim: true },
  publishedBy: { type: Schema.Types.ObjectId, ref: EModels.AUCTION_APPROVER, required: function(): boolean {
    return (this as IAuction).publishedStatus === EPublishedStatus.PUBLISHED;
  }, default: null },
  auctionLocation: { type: String, trim: true },
  numberOfLots: { type: Number, default: 0, min: 0, required: true },
  hasRegistrationFee: { type: Boolean, default: false, required: true },
  registrationFee: { type: Number, min: 0, required: function (): boolean {
    return (this as IAuction).hasRegistrationFee;
  } },
  auctionCoordinates: { 
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
  terms: { type: String, required: true, trim: true },
  startTime: { type: Date, required: true },
  participantsWithBiddingNumbers: { type: [String] },
  globallyEligibleBidders: { type: [String] },
  requiredAttributes: { type: [String] },
  endTime: { type: Date, required: true },
  status: { type: String, enum: [EAuctionStatus.NOT_BEGUN, EAuctionStatus.ACTIVE, EAuctionStatus.CANCELLED, EAuctionStatus.ENDED]},
  participationType: { type: String, default: EParticipationType.EVERYONE, enum: [EParticipationType.CITIZEN_ONLY, EParticipationType.EVERYONE]},
  isBeingLivestreamed: { type: Boolean, required: true , default: false},
  streamUrl: {type: String, required: function (): boolean {
    return (this as IAuction).isBeingLivestreamed;
  }, validate: {
    msg: 'Valid URL must be supplied.',
      validator: function (v: string): boolean {
        // Be less stringent in development
        if (process.env.NODE_ENV === ENVIRONMENT_PRODUCTION) { 
          return isURL(v, {protocols: ['https']});
        } else {
          return true;
        }
      }
    }
  }
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

auctionSchema.index({ auctionCoordinates: '2dsphere' });

auctionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret.globallyEligibleBidders;
    delete ret._id;
    delete ret.__t;
  }
});

auctionSchema.pre('save', async function () {
  const doc = this;

  if (doc.isNew || doc.isModified('title')) {
    doc.titleSlug = generateSlug(doc.title);
  }

  if (this.isModified('globallyEligibleBidders')) {
    await doc.$model(EModels.ITEM).updateMany({auctionId: doc._id}, {$set: { eligibleBidders: doc.globallyEligibleBidders }});
  }

  // PUBLISHED requires `publishedBy`
  if (
    doc.isModified('publishedStatus') && 
    doc.publishedStatus === EPublishedStatus.PUBLISHED && 
    !doc.publishedBy
  ) {
    throw new ForbiddenError('PUBLISHED auctions require a publishedBy admin.');
  }

  // REJECTED requires `reasonForRejection`
  if (
    doc.isModified('publishedStatus') && 
    doc.publishedStatus === EPublishedStatus.REJECTED && 
    !doc.reasonForRejection?.trim()
  ) {
    new ForbiddenError('REJECTED auctions require a reasonForRejection.');
  }

  // Prevent activating an unpublished auction
  if (
    doc.isModified('status') && 
    doc.status === EAuctionStatus.ACTIVE && 
    doc.publishedStatus !== EPublishedStatus.PUBLISHED
  ) {
    new ForbiddenError('Auction must be PUBLISHED before activation.');
  }

  // Ensure auctionCoordinates exist if auctionLocation is set
  if (doc.isModified('auctionLocation') && !doc.auctionCoordinates) {
    throw new Error('auctionCoordinates must be provided when setting auctionLocation.');
  }

  // Clear irrelevant fields when status changes
  if (doc.isModified('publishedStatus')) {
    switch (doc.publishedStatus) {
      case EPublishedStatus.PUBLISHED:
        doc.reasonForRejection = undefined;
        break;
      case EPublishedStatus.UNPUBLISHED:
        doc.reasonForRejection = undefined;
        doc.publishedBy = undefined;
        break;
      case EPublishedStatus.REJECTED:
        break;
    }
  }
});

auctionSchema.post('save', function(error: any, doc: any, next: any) {
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

export const Auction = model(EModels.AUCTION, auctionSchema);
export const RequiredAttribute = model(EModels.REQUIRED_ATTRIBUTE, requiredAttributeSchema);