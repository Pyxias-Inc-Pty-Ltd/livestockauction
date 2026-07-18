import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

// Form field types
export enum EFormFieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  SELECT = 'select',
  CHECKBOX = 'checkbox',
  RADIO = 'radio',
  TEXTAREA = 'textarea'
}

// Condition operators
export enum EConditionOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'notEquals',
  GREATER_THAN = 'greaterThan',
  LESS_THAN = 'lessThan',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'notContains',
  IS_EMPTY = 'isEmpty',
  IS_NOT_EMPTY = 'isNotEmpty',
  IS_CHECKED = 'isChecked',
  IS_NOT_CHECKED = 'isNotChecked'
}

// Single condition rule
export interface IConditionRule {
  field: string;  // name of the field this condition depends on
  operator: EConditionOperator;
  value?: any;    // not needed for operators like IS_EMPTY, IS_CHECKED
}

// Condition group with logical operators
export interface IConditionGroup {
  logicalOperator: 'AND' | 'OR';
  conditions: Array<IConditionRule | IConditionGroup>;
}

// Validation rules interface
export interface IValidationRule {
  type: string;
  value: any;
  message: string;
}

// Base form field interface
export interface IFormField {
  type: EFormFieldType;
  label: string;
  name: string;
  renderInUI: boolean;
  required?: boolean;
  placeholder?: string;
  defaultValue?: any;
  validation?: IValidationRule[];
  disabled?: boolean;
  order?: number;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options: Array<any>;
  minDate?: Date;
  maxDate?: Date;
  showCondition?: IConditionGroup;  // Field-level conditions
}

// Field specific interfaces
export interface ITextField extends IFormField {
  type: EFormFieldType.TEXT | EFormFieldType.TEXTAREA;
  minLength?: number;
  maxLength?: number;
}

export interface INumberField extends IFormField {
  type: EFormFieldType.NUMBER;
  min?: number;
  max?: number;
}

export interface IDateField extends IFormField {
  type: EFormFieldType.DATE;
  minDate?: Date;
  maxDate?: Date;
}

export interface ISelectField extends IFormField {
  type: EFormFieldType.SELECT;
  options: Array<{
    label: string;
    value: string | number;
    disabled?: boolean;
  }>;
}

export interface IChoiceField extends IFormField {
  type: EFormFieldType.CHECKBOX | EFormFieldType.RADIO;
  options: Array<{
    label: string;
    value: string | number;
    disabled?: boolean;
  }>;
}

// Form section interface
export interface IFormSection {
  title: string;
  description?: string;
  fields: Array<
    | ITextField
    | INumberField
    | IDateField
    | ISelectField
    | IChoiceField
  >;
  order?: number;
  showCondition?: IConditionGroup;  // Section-level conditions
}

// Main form interface
export interface IForm extends Document {
  creatorId: Schema.Types.ObjectId;
  sellerId: Schema.Types.ObjectId;
  categoryId: Schema.Types.ObjectId;
  gabsAccountId?: Schema.Types.ObjectId;
  identificationNumber: string;
  formAttributes: {
    title: string;
    description?: string;
    sections: IFormSection[];
  };
  description: string;
  createdDate: Date;
  updatedDate: Date;
}

// Mongoose schema definitions
const conditionRuleSchema = new Schema({
  field: { type: String, required: true },
  operator: { 
    type: String, 
    required: true,
    enum: Object.values(EConditionOperator)
  },
  value: Schema.Types.Mixed
}, { _id: false });

const conditionGroupSchema = new Schema({
  logicalOperator: { 
    type: String, 
    required: true,
    enum: ['AND', 'OR']
  },
  conditions: [{
    type: Schema.Types.Mixed,  // Can be either a rule or a nested group
    required: true
  }]
}, { _id: false });

const formFieldSchema = new Schema<IFormField>({
  type: { 
    type: String, 
    required: true, 
    enum: Object.values(EFormFieldType)
  },
  label: { type: String, required: true },
  name: { type: String, required: true },
  required: { type: Boolean, default: false },
  renderInUI: { type: Boolean, default: true },
  placeholder: String,
  defaultValue: Schema.Types.Mixed,
  validation: [{
    type: { type: String, required: true },
    value: Schema.Types.Mixed,
    message: String
  }],
  disabled: { type: Boolean, default: false },
  order: Number,
  showCondition: conditionGroupSchema,
  
  // Field specific properties
  minLength: Number,
  maxLength: Number,
  min: Number,
  max: Number,
  options: [{
    label: String,
    value: Schema.Types.Mixed,
    disabled: Boolean
  }],
  minDate: Date,
  maxDate: Date
}, { _id: false });

const formSectionSchema = new Schema<IFormSection>({
  title: { type: String, required: true },
  description: String,
  fields: [formFieldSchema],
  order: Number,
  showCondition: conditionGroupSchema
}, { _id: false });

const schema = new Schema<IForm>({
  creatorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.ADMIN },
  sellerId: { type: Schema.Types.ObjectId, required: true, ref: EModels.SELLER },
  categoryId: { type: Schema.Types.ObjectId, required: true, ref: EModels.CATEGORY },
  gabsAccountId: { type: Schema.Types.ObjectId, ref: EModels.GABS_ACCOUNT },
  identificationNumber: { type: String, required: true, trim: true, unique: true },
  formAttributes: {
    title: { type: String, required: true },
    description: String,
    sections: [formSectionSchema]
  },
  description: { type: String, required: true, trim: true }
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

export const Form = model(EModels.FORM, schema);