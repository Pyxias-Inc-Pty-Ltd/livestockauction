import { ConflictError, NotFoundError, InternalServerError } from '../shared/errors';
import { Schema, model, Document } from 'mongoose';
import { itemStatus, EModels, EItemStatus, genderType, EGenderType, EPublishedStatus } from '../globals';
import { generateSlug } from '../shared/functions';
import { IAuction } from './auction-model';
import { esService } from '../services/elasticsearch-service';

export interface IItemMetadata {
  categoryId?: Schema.Types.ObjectId | string;
  isLivestock?: boolean;
  isMultipleAnimals?: boolean;
  isAStud?: boolean;
  dob?: Date;
  studRegistrationNumber?: string;
  numberOfCalvesBorn?: number;
  gender?: genderType;
  breed?: string;
  animalEID?: string;
  animalEIDs?: Array<string>;
  serialNumber?: string;
  baitsDump?: string;
  baitsDumps?: Array<string>;
  machineType?: string;
  make?: string;
  model?: string;
  year?: Date;
  mileage?: number;
  engineNumber?: string;
  chassisNumber?: string;
  registrationNumber?: string;
  colour?: string;
  condition?: string;
  hoursUsed?: number;
  age?: number;
  power?: number;
  isOperational?: boolean;
}

export interface IEligibleBidder {
  firstName?: string;
  lastName?: string;
  name?: string;
  keeperId: string;
  bidderNumber: string | null;
}

export interface IItem extends Document {
  formId: Schema.Types.ObjectId;
  creatorId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  gallery: Array<string>;
  title: {
    en: string,
    tn: string;
  };
  description: {
    en: string,
    tn: string;
  };
  terms: {
    en: string,
    tn: string;
  };
  isBidIncrementedManually: boolean;
  isClosedBidding: boolean;
  manualBidAmount: number; // Set by the auction master, usually used in livestream bids
  startingBid: number;
  bidIncrement?: number;
  reservePrice: number;
  eligibleBidders: Array<string>;
  invitedBidders: Array<string>;
  winningBidder?: Schema.Types.ObjectId;
  currentBid?: number; // Used in non closed bid scenarios, to show other users the current bid amount to compete against
  titleSlug: {
    en: string;
    tn: string;
  };
  buyoutPrice?: number;
  startTime: Date;
  endTime: Date;
  version: number;
  status: itemStatus;
  isPurchased: boolean;
  createdDate: Date;
  updatedDate: Date;
  metadata: IItemMetadata
}

export interface IItemInput {
  gallery: Array<string>;
  creatorId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  auctionId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  isBidIncrementedManually?: boolean;
  isClosedBidding?: boolean;
  manualBidAmount?: number;
  invitedBidders?: Array<string>;
  metadata: IItemMetadata,
  title: {
    en: string,
    tn: string;
  };
  description: {
    en: string,
    tn: string;
  };
  baitsDump?: string;
  isPurchased?: boolean;
  terms: {
    en: string,
    tn: string;
  };
  startingBid: number;
  status: itemStatus;
  bidIncrement?: number;
  reservePrice: number;
  startTime: Date;
  endTime: Date;
}

const schema = new Schema<IItem>({
  formId: { type: Schema.Types.ObjectId, required: true, ref: EModels.FORM },
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  auctionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  winningBidder: { type: Schema.Types.ObjectId, ref: EModels.BIDDER },
  title: {
    en: { type: String, required: true, trim: true },
    tn: { type: String, required: true, trim: true }
  },
  titleSlug: {
    en: { type: String, trim: true },
    tn: { type: String, trim: true }
  },
  description: {
    en: { type: String, required: true, trim: true },
    tn: { type: String, required: true, trim: true }
  },
  terms: {
    en: { type: String, required: true, trim: true },
    tn: { type: String, required: true, trim: true }
  },
  startingBid: { type: Number, required: true },
  isPurchased: { type: Boolean, default: false, required: true },
  bidIncrement: { type: Number, required: function (): boolean {
    return !(this as IItem).isBidIncrementedManually && !(this as IItem).isClosedBidding;
  } },
  reservePrice: { type: Number, required: true },
  currentBid: { type: Number },
  buyoutPrice: { type: Number },
  manualBidAmount: { type: Number, default: 0 },
  isBidIncrementedManually: {type: Boolean, default: false},
  isClosedBidding: {type: Boolean, default: false},
  gallery: { type: [String], required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: [EItemStatus.NOT_BEGUN, EItemStatus.ACTIVE, EItemStatus.CANCELLED, EItemStatus.ENDED]},
  eligibleBidders: [String],
  invitedBidders: [String],
  version: { type: Number, default: 0 },
  metadata: {
    categoryId: { 
      type: Schema.Types.ObjectId, 
      ref: EModels.CATEGORY
    },
    isLivestock: { 
      type: Boolean
    },
    isAStud: { 
      type: Boolean,
      required: function(this: IItem) {
        return this.metadata.isLivestock === true;
      }
    },
    dob: { 
      type: Date,
      required: function(this: IItem) {
        return this.metadata.isLivestock
      }
    },
    studRegistrationNumber: { 
      type: String,
      trim: true,
      required: function(this: IItem) {
        return this.metadata.isLivestock && this.metadata.isAStud === true;
      }
    },
    numberOfCalvesBorn: { 
      type: Number,
      min: 0
    },
    gender: { 
      type: String,
      enum: Object.values(EGenderType),
      required: function(this: IItem) {
        return this.metadata.isLivestock === true;
      }
    },
    breed: { 
      type: String,
      trim: true,
      required: function(this: IItem) {
        return this.metadata.isLivestock === true;
      }
    },
    animalEID: { 
      type: String,
      trim: true,
      required: function(this: IItem) {
        return this.metadata.isLivestock === true;
      }
    },
    serialNumber: { 
      type: String,
      trim: true
    },
    baitsDump: { 
      type: String,
      trim: true
    },
    machineType: {
      type: String,
      trim: true
    },
    make: {
      type: String,
      trim: true
    },
    model: {
      type: String,
      trim: true
    },
    engineNumber: {
      type: String,
      trim: true
    },
    chassisNumber: {
      type: String,
      trim: true
    },
    registrationNumber: {
      type: String,
      trim: true
    },
    colour: {
      type: String,
      trim: true
    },
    year: {
      type: Date
    },
    condition: {
      type: String,
      trim: true
    },
    hoursUsed: {
      type: Number,
      min: 0
    },
    power: {
      type: Number,
      min: 0
    },
    age: {
      type: Number,
      min: 0
    },
    mileage: {
      type: Number,
      min: 0
    },
    isOperational: {
      type: Boolean
    }
  }
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

schema.index({ 'titleSlug.en': 1, 'auctionId': 1 }, { unique: true, sparse: true });
schema.index({ 'titleSlug.tn': 1, 'auctionId': 1 }, { unique: true, sparse: true });

schema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret.invitedBidders;
    delete ret._id;
    delete ret.__t;
  }
});

schema.pre('save', async function () {
  const doc = this;
  this.$locals.isNew = doc.isNew;

  if (doc.isNew) {
    const auction = await doc.$model(EModels.AUCTION).findById(doc.auctionId, {globallyEligibleBidders: 1}) as IAuction | null;

    // Check if exists
    if (!auction) {
      throw new NotFoundError('Auction not found');
    }

    for (const globallyEligibleBidder of auction.globallyEligibleBidders) {
      if (doc.eligibleBidders.indexOf(globallyEligibleBidder) === -1) {
        doc.eligibleBidders.push(globallyEligibleBidder);
      }
    }
  }

  if (doc.isNew || doc.isModified('title.en')) {
    doc.titleSlug.en = generateSlug(doc.title.en);
  }
  if (doc.isNew || doc.isModified('title.tn')) {
    doc.titleSlug.tn = generateSlug(doc.title.tn);
  }
});

schema.pre('save', async function() {
  const doc = this;

  // Check that isBidIncrementedManually and isClosedBidding aren't both true
  if (doc.isBidIncrementedManually && doc.isClosedBidding) {
    throw new InternalServerError('An item cannot have both isBidIncrementedManually and isClosedBidding set to true');
  }

  // Validate livestock-specific fields
  if (doc.metadata.isLivestock) {
    // Required fields check
    const requiredFields = ['animalEID', 'gender', 'breed'];
    for (const field of requiredFields) {
      if (!(doc.metadata as any)[field]) {
        throw new InternalServerError(`${field} is required for livestock items`);
      }
    }

    // Stud-specific validation
    if (doc.metadata.isAStud && !doc.metadata.studRegistrationNumber) {
      throw new InternalServerError('studRegistrationNumber is required for stud animals');
    }

    // Female cattle validation
    if (doc.metadata.gender === 'FEMALE' && doc.metadata.breed === 'cattle') {
      if (typeof doc.metadata.numberOfCalvesBorn !== 'number') {
        throw new InternalServerError('numberOfCalvesBorn is required for female cattle');
      }
    }

    // DOB validation for non-mixed gender
    if (doc.metadata.gender !== 'MIXED' && !doc.metadata.dob) {
      throw new InternalServerError('dob is required for animals with specific gender');
    }
  }
});

schema.post('save', async function(doc: IItem) {
  try {
    if (!doc.$locals.isNew) {
      // Fetch the associated auction using $model
      const auction = await doc.$model(EModels.AUCTION).findById(doc.auctionId) as IAuction | null;
      
      if (!auction) {
        console.error('Associated auction not found'); // TODO: Log to winston
        return;
      }

      if (auction.publishedStatus === EPublishedStatus.PUBLISHED) {
        // Only index if the auction is published
        await esService.indexItem(doc);
      } else {
        // If auction is not published, ensure the item is removed from ES
        try {
          await esService.removeItem(doc._id);
        } catch (error) {
          // Ignore if item wasn't in ES
          if (!error.message.includes('not_found')) {
            console.error('Error handling item indexing:', error); // TODO: Log to winston
          }
        }
      }
    }
  } catch (error) {
    console.error('Error handling item indexing:', error); // TODO: Log to winston
  }
});

schema.post('remove', async function(doc: IItem) {
  try {
    await esService.removeItem(doc._id);
  } catch (error) {
    console.error('Error removing item from index:', error); // TODO: Log to winston
  }
});

schema.post('save', function(error: any, doc: any, next: any) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    if (error.message.includes('titleSlug.en_1')) {
      next(new ConflictError('An item with this title already exists'));
    } else if (error.message.includes('titleSlug.tn_1')) {
      next(new ConflictError('An item with this title already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});


export const Item = model(EModels.ITEM, schema);