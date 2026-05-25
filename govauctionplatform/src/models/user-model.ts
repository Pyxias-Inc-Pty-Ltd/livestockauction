import { InternalServerError } from '../shared/errors';
import { Schema, model, Document, Model } from 'mongoose';
import { adminType, EGenderType, EModels, ENVIRONMENT_PRODUCTION, EUserType, genderType, userType, welcomeAuctionApproverEmailTemplate, welcomeBidderEmailTemplate, welcomeSellerEmailTemplate, EIdentityNumberVerificationStatus, identityNumberVerificationStatus, SERVICE_URLS, invalidNationalIDSMSTemplate, nameMismatchWithNationalIDSMSTemplate, nationalIDVerificationIssuesSMSTemplate, nationalIDVerificationSuccessSMSTemplate, companyRegistrationVerificationSuccessTemplate, invalidCompanyRegistrationTemplate, companyRegistrationVerificationIssuesTemplate, ID_VERIFICATION_API_KEY, sectorType, ESectorType } from '../globals';
import isEmail from 'validator/lib/isEmail';
import * as axios from 'axios';
import isURL from 'validator/lib/isURL';
import { formatPhoneNumber } from '../shared/functions';

export interface IUser extends Document {
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  userType: userType;
  phone?: string;
  email?: string;
  tz: string;
  locale: string;
  firebaseTokenId: string;
  password?: string;
  keycloakId: string;
  createdDate: any;
  updatedDate: any;
}

export interface ISeller extends IUser {
  sectorType: sectorType;
  name: string;
  allowedRequiredAttributes: Schema.Types.ObjectId[];
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
  identityNumberVerificationRetryCount: number;
  identityNumberVerificationStatus: identityNumberVerificationStatus;
  reasonForIdentityNumberVerificationRejection?: string;
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

export interface IAuctionApprover extends IUser {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  password: string;
  createdBySeller: Schema.Types.ObjectId;
  isActive: boolean;
}

export interface IAuctionApproverInput {
  createdBySeller: string;
  password: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  locale: string;
  tz: string;
}

const userSchema = new Schema<IUser>({
  userType: {type: String, required: true, enum: [EUserType.ADMIN, EUserType.BIDDER, EUserType.SELLER, EUserType.AUCTION_APPROVER]},
  keycloakId: {type: String, trim: true, unique: true, sparse: true},
  email: {type: String, unique: true, sparse: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  firstName: {type: String, trim: true},
  lastName: {type: String, trim: true},
  phone: {type: String, trim: true},
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
  keycloakId: {type: String, trim: true, unique: true, sparse: true},
  email: {type: String, unique: true, sparse: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  identityNumberVerificationRetryCount: { type: Number, default: 0, required: true },
  identityNumberVerificationStatus: {type: String, enum: [EIdentityNumberVerificationStatus.PENDING, EIdentityNumberVerificationStatus.VERIFICATION_REJECTED, EIdentityNumberVerificationStatus.VERIFIED], default: EIdentityNumberVerificationStatus.PENDING},
  isOrganization: {type: Boolean, default: false},
  reasonForIdentityNumberVerificationRejection: { type: String, trim: true },
  firstName: { type: String, required: function(): boolean {
    return !(this as IBidder).isOrganization;
  }, trim: true },
  lastName: { type: String, required: function(): boolean {
    return !(this as IBidder).isOrganization;
  }, trim: true },
  name: { type: String, required: function(): boolean {
    return (this as IBidder).isOrganization;
  }, trim: true },
  phone: {type: String, trim: true},
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
      const { email, phone, firstName, lastName, name, isOrganization, identityNumberVerificationStatus, identityNumberVerificationRetryCount, identityNumber } = doc;

      if (email) {
        // Queue message
        const textContent = welcomeBidderEmailTemplate.replace('[UserName]', name as string);
        await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
          data: {
            subject: 'Welcome to the Botswana Government Auction Platform',
            email,
            message: textContent
          }
        }, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ID_VERIFICATION_API_KEY
          }
        });
      }

      // Check if identityNumberVerificationStatus is pending
      if (identityNumberVerificationStatus === "PENDING") {
        try {
          if (isOrganization) {

            // For individuals, first make a GET request to verify the UIN
            const getResponse = await axios.default.get(`${SERVICE_URLS.idVerificationURI}/cipa/company/${identityNumber}`, {
              headers: {
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });

            // Check if the GET request was successful and the response indicates success
            if (getResponse.status === 200 && getResponse.data.success === true) {
              doc.identityNumberVerificationStatus = "VERIFIED";
              await doc.save();
              // Queue message
              const textContent = companyRegistrationVerificationSuccessTemplate.replace('[UserName]', firstName as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
                data: {
                  subject: 'Company Registration Number Verification Successful',
                  email,
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            } else if (getResponse.status === 200 && getResponse.data.success === false) {
              doc.identityNumberVerificationStatus = "VERIFICATION_REJECTED";
              doc.reasonForIdentityNumberVerificationRejection = "Invalid UIN provided";
              await doc.save();
              // Queue message
              const textContent = invalidCompanyRegistrationTemplate.replace('[UserName]', firstName as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
                data: {
                  subject: 'Invalid Company Registration Number',
                  email,
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            } else if (getResponse.status !== 200) {

              if (identityNumberVerificationRetryCount < 1) {
                // Queue message
                const textContent = companyRegistrationVerificationIssuesTemplate.replace('[UserName]', firstName as string);
                await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
                  data: {
                    subject: 'Temporary Issues with Company Registration Number Verification',
                    email,
                    message: textContent
                  }
                }, {
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": ID_VERIFICATION_API_KEY
                  }
                });
              }

              doc.identityNumberVerificationRetryCount += 1;
              await doc.save();

              // For organizations, directly send the POST request
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/verifyCompanyQueue/add-job`, {
                data: {
                  userId: doc.id
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
              console.log('Payload sent to verifyCompanyQueue');
            }
          } else {
            // For individuals, first make a GET request to verify the Omang
            const getResponse = await axios.default.get(`${SERVICE_URLS.idVerificationURI}/omang/payload/${identityNumber}`, {
              headers: {
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });

            // Check if the GET request was successful and the response indicates success
            if (getResponse.status === 200 && getResponse.data.success === true) {
              const { data } = getResponse.data;
              const lowerCaseFirstName = (data[0]['FIRST_NME'] as string).toLowerCase();
              const lowerCaseLastName = (data[0]['SURNME'] as string).toLowerCase();
              if (lowerCaseFirstName.includes(firstName!.toLowerCase()) && lowerCaseLastName.includes(lastName!.toLowerCase())) {
                doc.identityNumberVerificationStatus = "VERIFIED";
                await doc.save();
                // Queue message
                const textContent = nationalIDVerificationSuccessSMSTemplate.replace('[UserName]', firstName as string);
                await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                  data: {
                    subject: 'onlineauction.gov.bw',
                    phone: formatPhoneNumber(phone!),
                    message: textContent
                  }
                }, {
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": ID_VERIFICATION_API_KEY
                  }
                });
              } else {
                doc.identityNumberVerificationStatus = "VERIFICATION_REJECTED";
                doc.reasonForIdentityNumberVerificationRejection = "Name mismatch with Omang provided";
                await doc.save();
                // Queue message
                const textContent = nameMismatchWithNationalIDSMSTemplate.replace('[UserName]', firstName as string);
                await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                  data: {
                    subject: 'onlineauction.gov.bw',
                    phone: formatPhoneNumber(phone!),
                    message: textContent
                  }
                }, {
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": ID_VERIFICATION_API_KEY
                  }
                });
              }
            } else if (getResponse.status === 200 && getResponse.data.success === false) {
              doc.identityNumberVerificationStatus = "VERIFICATION_REJECTED";
              doc.reasonForIdentityNumberVerificationRejection = "Invalid Omang provided";
              await doc.save();
              // Queue message
              const textContent = invalidNationalIDSMSTemplate.replace('[UserName]', firstName as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                data: {
                  subject: 'onlineauction.gov.bw',
                  phone: formatPhoneNumber(phone!),
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            } else if (getResponse.status !== 200) {

              if (identityNumberVerificationRetryCount < 1) {
                // Queue message
                const textContent = nationalIDVerificationIssuesSMSTemplate.replace('[UserName]', firstName as string);
                await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                  data: {
                    subject: 'onlineauction.gov.bw',
                    phone: formatPhoneNumber(phone!),
                    message: textContent
                  }
                }, {
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": ID_VERIFICATION_API_KEY
                  }
                });
              }

              doc.identityNumberVerificationRetryCount += 1;
              await doc.save();

              // If the GET request fails or the response is not successful, send the POST request
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/verifyOmangQueue/add-job`, {
                data: {
                  userId: doc.id
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
              console.log('Payload sent to verifyOmangQueue');
            }
          }
        } catch (error) {
          console.error('Error during verification process:', error);
        }
      }

      next();
    } catch (error) {
      next(new InternalServerError('Error sending welcome email'));
    }
  }
});

const sellerSchema = new Schema<ISeller>({
  userType: {type: String, required: true, default: EUserType.SELLER, enum: [EUserType.SELLER]},
  keycloakId: {type: String, trim: true, unique: true, sparse: true},
  sectorType: { type: String, default: ESectorType.GOVERNMENT, enum: [ESectorType.PRIVATE, ESectorType.GOVERNMENT], required: true },
  allowedRequiredAttributes: { type: [{ type: Schema.Types.ObjectId, ref: EModels.REQUIRED_ATTRIBUTE }], default: [] },
  email: {type: String, unique: true, required: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  name: {type: String, required: true, trim: true},
  phone: {type: String, trim: true},
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
    
      await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
        data: {
          subject: 'Welcome to the Botswana Government Auction Platform',
          email,
          message: htmlContent
        }
      }, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ID_VERIFICATION_API_KEY
        }
      });

      next();
    } catch (error) {
      next(new InternalServerError('Error sending welcome email'));
    }
  }
});

const adminSchema = new Schema<IAdmin>({
  userType: {type: String, required: true, default: EUserType.ADMIN, enum: [EUserType.ADMIN]},
  keycloakId: {type: String, trim: true, unique: true, sparse: true},
  email: {type: String, unique: true, required: true, validate: {
    msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  firstName: {type: String, required: true, trim: true},
  lastName: {type: String, required: true, trim: true},
  phone: {type: String, trim: true},
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

const auctionApproverSchema = new Schema<IAuctionApprover>({
  userType: {
    type: String,
    required: true,
    default: EUserType.AUCTION_APPROVER,
    enum: [EUserType.AUCTION_APPROVER]
  },
  keycloakId: {type: String, trim: true, unique: true, sparse: true},
  email: {
    type: String,
    unique: true,
    required: true,
    validate: {
      msg: 'Valid email must be supplied.',
      validator: function (v: string): boolean {
        return isEmail(v);
      }
    }
  },
  phone: {type: String, trim: true},
  password: {type: String, trim: true},
  firstName: {
    type: String, 
    required: true, 
    trim: true
  },
  lastName: {
    type: String, 
    required: true, 
    trim: true
  },
  tz: {
    type: String, 
    trim: true, 
    required: true
  },
  locale: {
    type: String, 
    trim: true, 
    required: true
  },
  createdBySeller: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: EModels.SELLER
  },
  isActive: {
    type: Boolean,
    required: true,
    default: true
  }
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

auctionApproverSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.password;
    delete ret.__t;
  }
});

auctionApproverSchema.post('save', async function (doc, next) {
  if (this.$locals.isNew) {
    try {
      const { email, firstName } = doc;
      const htmlContent = welcomeAuctionApproverEmailTemplate.replace('[UserName]', firstName);
    
      await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
        data: {
          subject: 'Welcome to the Botswana Government Auction Platform',
          email,
          message: htmlContent
        }
      }, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ID_VERIFICATION_API_KEY
        }
      });

      next();
    } catch (error) {
      next(new InternalServerError('Error sending welcome email'));
    }
  }
});

export const User: Model<IUser> = model(EModels.USER, userSchema);

// Attach discriminators
export const Admin = User.discriminator(EModels.ADMIN, adminSchema);
export const Bidder = User.discriminator(EModels.BIDDER, bidderSchema);
export const Seller = User.discriminator(EModels.SELLER, sellerSchema);
export const AuctionApprover = User.discriminator(EModels.AUCTION_APPROVER, auctionApproverSchema);