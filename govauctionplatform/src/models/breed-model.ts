import { generateSlug } from '../shared/functions';
import { Schema, model, Document } from 'mongoose';
import { animalSpecies, EAnimalSpecies, EModels } from '../globals';
import { ConflictError } from '../shared/errors';

export interface IBreed extends Document {
  name: string;
  categoryId: Schema.Types.ObjectId;
  animalSpecies: animalSpecies;
  nameSlug: string;
  createdDate: any;
  updatedDate: any;
}

export interface IBreedInput {
  categoryId: Schema.Types.ObjectId;
  name: string;
  animalSpecies: animalSpecies;
}

const schema = new Schema<IBreed>({
  name: { type: String, required: true, trim: true },
  animalSpecies: { type: String, required: true, enum: [EAnimalSpecies.BOVINE, EAnimalSpecies.CAPRINE, EAnimalSpecies.EQUINE, EAnimalSpecies.OVINE, EAnimalSpecies.PORCINE] },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
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
      next(new ConflictError('A breed with this name already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

export const Breed = model(EModels.BREED, schema);