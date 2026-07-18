import { Schema, Document, model } from 'mongoose';
import { EModels } from '../globals';

export interface IGabsAccount extends Document {
  sellerId: Schema.Types.ObjectId;
  ministry: string;
  department: string;
  parentAccount: string;
  accountNumber: string;
  accountName: string;
}

const gabsAccountSchema = new Schema<IGabsAccount>({
  sellerId: { type: Schema.Types.ObjectId, ref: EModels.SELLER, required: true, index: true },
  ministry: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  parentAccount: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  accountName: { type: String, required: true, trim: true },
}, {
  timestamps: true,
});

gabsAccountSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (_doc, ret) {
    delete ret._id;
  }
});

export const GabsAccount = model<IGabsAccount>(EModels.GABS_ACCOUNT, gabsAccountSchema);
