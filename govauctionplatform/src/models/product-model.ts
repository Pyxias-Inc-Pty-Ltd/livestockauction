import { ConflictError, InternalServerError } from '../shared/errors';
import { Schema, model, Document } from 'mongoose';
import { EModels, productStatus, EProductStatus, productCondition, EProductCondition } from '../globals';
import { generateSlug } from '../shared/functions';

export interface IProductVariant {
  sku: string;
  price: number;
  compareAtPrice?: number;
  quantity: number;
  attributes: Record<string, string>;
}

export interface IProduct extends Document {
  creatorId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  gallery: Array<string>;
  title: string;
  description: string;
  titleSlug: string;
  condition: productCondition;
  brand?: string;
  model?: string;
  sku?: string;
  price: number;
  compareAtPrice?: number;
  quantity: number;
  variants?: Array<IProductVariant>;
  status: productStatus;
  isVisible: boolean;
  hasVariants: boolean;
  specifications: Record<string, any>;
  shippingDetails: {
    weight?: number;
    width?: number;
    height?: number;
    length?: number;
    shippingClass?: string;
    requiresShipping: boolean;
    freeShipping: boolean;
  };
  metadata: Record<string, any>;
  createdDate: any;
  updatedDate: any;
}

export interface IProductInput {
  creatorId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  gallery: Array<string>;
  title: string;
  description: string;
  condition: productCondition;
  brand?: string;
  model?: string;
  sku?: string;
  price: number;
  compareAtPrice?: number;
  quantity: number;
  variants?: Array<IProductVariant>;
  status?: productStatus;
  isVisible?: boolean;
  hasVariants?: boolean;
  specifications?: Record<string, any>;
  shippingDetails?: {
    weight?: number;
    width?: number;
    height?: number;
    length?: number;
    shippingClass?: string;
    requiresShipping?: boolean;
    freeShipping?: boolean;
  };
}

const variantSchema = new Schema<IProductVariant>({
  sku: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  quantity: { type: Number, required: true, min: 0 },
  attributes: { type: Schema.Types.Mixed, required: true }
}, { _id: true });

const schema = new Schema<IProduct>({
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
  title: { type: String, required: true, trim: true },
  titleSlug: { type: String, trim: true },
  description: { type: String, required: true, trim: true },
  condition: { 
    type: String, 
    enum: [
      EProductCondition.NEW, 
      EProductCondition.USED, 
      EProductCondition.REFURBISHED
    ], 
    required: true 
  },
  brand: { type: String, trim: true },
  model: { type: String, trim: true },
  sku: { type: String, trim: true, sparse: true },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  quantity: { type: Number, required: true, min: 0 },
  variants: [variantSchema],
  gallery: { type: [String], required: true },
  status: { 
    type: String, 
    enum: [
      EProductStatus.DRAFT, 
      EProductStatus.ACTIVE, 
      EProductStatus.INACTIVE, 
      EProductStatus.OUT_OF_STOCK
    ],
    default: EProductStatus.DRAFT
  },
  isVisible: { type: Boolean, default: false },
  hasVariants: { type: Boolean, default: false },
  specifications: { type: Schema.Types.Mixed, default: {} },
  shippingDetails: {
    weight: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    length: { type: Number, min: 0 },
    shippingClass: { type: String },
    requiresShipping: { type: Boolean, default: true },
    freeShipping: { type: Boolean, default: false }
  },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, {
  timestamps: {
    createdAt: "createdDate",
    updatedAt: "updatedDate"
  }
});

schema.index({ titleSlug: 1, _id: 1 }, { unique: true });
schema.index({ sku: 1 }, { sparse: true });

schema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__t;
  }
});

schema.pre('save', async function() {
  const doc = this;

  if (doc.isNew || doc.isModified('title')) {
    doc.titleSlug = generateSlug(doc.title);
  }

  // Set status to OUT_OF_STOCK if quantity is 0
  if (doc.isModified('quantity') && doc.quantity === 0) {
    doc.status = EProductStatus.OUT_OF_STOCK;
  }

  // Validate variants if product has variants
  if (doc.hasVariants && (!doc.variants || doc.variants.length === 0)) {
    throw new InternalServerError('Products with variants must have at least one variant');
  }
});

schema.post('save', function(error: any, doc: any, next: any) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    if (error.message.includes('titleSlug_1__id_1')) {
      next(new ConflictError('A product with this title already exists'));
    } else if (error.message.includes('sku_1')) {
      next(new ConflictError('A product with this SKU already exists'));
    } else {
      next(new ConflictError('Duplicate key error'));
    }
  } else {
    next();
  }
});

export const Product = model(EModels.PRODUCT, schema);