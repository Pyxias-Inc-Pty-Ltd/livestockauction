import { generateSlug } from '../shared/functions';
import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';
import { ConflictError } from '../shared/errors';

export interface ICategory extends Document {
  name: string;
  nameSlug: string;
  createdDate: any;
  updatedDate: any;
}

export interface ICategoryInput {
  name: string;
}

const schema = new Schema<ICategory>({
  name: { type: String, required: true, trim: true },
  nameSlug: {type: String, trim: true, sparse: true, unique: true}
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

schema.pre('save', async function () {
  const doc = this;

  if (doc.isNew || doc.isModified('name')) {
    doc.nameSlug = generateSlug(doc.name);
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

schema.post('save', function(error: any, doc: any, next: any) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    if (error.message.includes('nameSlug_1')) {
      next(new ConflictError('An category with this name already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

export const Category = model(EModels.CATEGORY, schema);