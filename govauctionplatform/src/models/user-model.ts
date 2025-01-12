import { InternalServerError } from '../shared/errors';
import { Schema, model, Document, Model } from 'mongoose';
import { adminType, EGenderType, EModels, ENVIRONMENT_PRODUCTION, EUserType, genderType, userType, VERIFIED_EMAIL, welcomeBidderEmailTemplate, welcomeSellerEmailTemplate } from '../globals';
import isEmail from 'validator/lib/isEmail';
import isURL from 'validator/lib/isURL';
import { sgMail } from '../index';

export interface IUser extends Document {
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  userType: userType;
  phone: string;
  email?: string;
  tz: string;
  locale: string;
  firebaseTokenId: string;
  password: string;
  createdDate: any;
  updatedDate: any;
}

export interface ISeller extends IUser {
  name: string;
}

export interface ISellerInput {
  email: string;
  phone: string;
  password: string;
  name: string;
  locale: string;
  tz: string;
}

export interface IUpdateSellerInput {
  photoUrl?: string;
  email?: string;
  phone?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
}

export interface IBidder extends IUser {
  name?: string;
  isOrganization: boolean;
  identityNumber: string;
  nationality: string;
  dob: Date;
  gender: genderType;
  physicalAddress: string;
  postalAddress: string;
  keeperId?: string;
  isKeeperIdVerified: boolean;
  keeperIdHash: string;
}

export interface IBidderInput {
  isOrganization: boolean;
  identityNumber: string;
  nationality?: string;
  dob?: Date;
  gender?: genderType;
  physicalAddress: string;
  postalAddress: string;
  email?: string;
  phone: string;
  password: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  locale: string;
  tz: string;
}

export interface IUpdateBidderInput {
  photoUrl?: string;
  email?: string;
  phone?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  identityNumber?: string;
  nationality?: string;
  dob?: Date;
  gender?: genderType;
  physicalAddress?: string;
  postalAddress?: string;
  keeperId?: string;
  keeperIdHash?: string;
}

export interface IAdmin extends IUser {
  firstName: string;
  lastName: string;
  adminType: adminType;
  email: string;
}

export interface IAdminInput {
  adminType: adminType;
  email: string;
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  locale: string;
  tz: string;
}

export interface IUpdateAdminInput {
  photoUrl?: string;
  email?: string;
  phone?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
}

const userSchema = new Schema<IUser>({
  userType: {type: String, required: true, enum: [EUserType.ADMIN, EUserType.BIDDER]},
  email: {type: String, unique: true, sparse: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  firstName: {type: String, trim: true},
  lastName: {type: String, trim: true},
  phone: {type: String, trim: true, required: true},
  password: {type: String, trim: true},
  tz: {type: String, trim: true, required: true},
  locale: {type: String, trim: true, required: true},
  photoUrl: {type: String, validate: {
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
  },
  firebaseTokenId: {type: String, trim: true}
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.password;
    delete ret.__t;
  }
});

// Pre-save hook for userSchema
userSchema.pre('save', async function(next) {
  if (this.isNew) {
    this.$locals.isNew = true;
  } else {
    this.$locals.isNew = false;
  }
  next();
});

const bidderSchema = new Schema<IBidder>({
  userType: {type: String, required: true, default: EUserType.BIDDER, enum: [EUserType.BIDDER]},
  email: {type: String, unique: true, sparse: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  isOrganization: {type: Boolean, default: false},
  firstName: { type: String, required: function(): boolean {
    return !(this as IBidder).isOrganization;
  }, trim: true },
  lastName: { type: String, required: function(): boolean {
    return !(this as IBidder).isOrganization;
  }, trim: true },
  name: { type: String, required: function(): boolean {
    return (this as IBidder).isOrganization;
  }, trim: true },
  phone: {type: String, trim: true, required: true},
  password: {type: String, trim: true},
  isKeeperIdVerified: {type: Boolean, required: true, default: false},
  tz: {type: String, trim: true, required: true},
  locale: {type: String, trim: true, required: true},
  photoUrl: {type: String, validate: {
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
  },
  identityNumber: {type: String, required: true, trim: true, unique: true},
  nationality: {type: String, required: true, trim: true},
  dob: {
    type: Date,
    required: function(this: IBidder) { return !this.isOrganization; }
  },
  gender: {
    type: String,
    required: function(this: IBidder) { return !this.isOrganization; },
    enum: [EGenderType.FEMALE, EGenderType.MALE]
  },
  physicalAddress: {type: String, required: true, trim: true},
  postalAddress: {type: String, required: true, trim: true},
  keeperId: {type: String, trim: true},
  keeperIdHash: {type: String}
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

bidderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.password;
    delete ret.__t;
  }
});

bidderSchema.post('save', async function (doc, next) {
  if (this.$locals.isNew) {
    try {

      const { email, phone, firstName, name, isOrganization } = doc;

      const htmlContent = welcomeBidderEmailTemplate.replace('[UserName]', isOrganization ? name as string : firstName as string);
      
      if (!isOrganization) {
        // TODO: Send to phone via SMS
      } else {
        await sgMail.send({
            to: email,
            from: VERIFIED_EMAIL,
            subject: 'Welcome to the Botswana Government Auction Platform',
            html: htmlContent
        });
      }

      next();
    } catch (error) {
      next(new InternalServerError('Error sending welcome email'));
    }
  }
});

const sellerSchema = new Schema<ISeller>({
  userType: {type: String, required: true, default: EUserType.SELLER, enum: [EUserType.SELLER]},
  email: {type: String, unique: true, required: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  name: {type: String, required: true, trim: true},
  phone: {type: String, trim: true, required: true},
  password: {type: String, trim: true},
  tz: {type: String, trim: true, required: true},
  locale: {type: String, trim: true, required: true},
  photoUrl: {type: String, validate: {
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

sellerSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.password;
    delete ret.__t;
  }
});

sellerSchema.post('save', async function (doc, next) {
  if (this.$locals.isNew) {
    try {

      const { email, name } = doc;

      const htmlContent = welcomeSellerEmailTemplate.replace('[UserName]', name);
    
      await sgMail.send({
          to: email,
          from: VERIFIED_EMAIL,
          subject: 'Welcome to the Botswana Government Auction Platform',
          html: htmlContent
      });

      next();
    } catch (error) {
      next(new InternalServerError('Error sending welcome email'));
    }
  }
});

const adminSchema = new Schema<IAdmin>({
  userType: {type: String, required: true, default: EUserType.ADMIN, enum: [EUserType.ADMIN]},
  email: {type: String, unique: true, required: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  firstName: {type: String, required: true, trim: true},
  lastName: {type: String, required: true, trim: true},
  phone: {type: String, trim: true, required: true},
  password: {type: String, trim: true},
  tz: {type: String, trim: true, required: true},
  locale: {type: String, trim: true, required: true},
  photoUrl: {type: String, validate: {
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

adminSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.password;
    delete ret.__t;
  }
});

export const User: Model<IUser> = model(EModels.USER, userSchema);

// Attach discriminators
export const Admin = User.discriminator(EModels.ADMIN, adminSchema);
export const Bidder = User.discriminator(EModels.BIDDER, bidderSchema);
export const Seller = User.discriminator(EModels.SELLER, sellerSchema);