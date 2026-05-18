import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export type ERefundBatchStatus = 'SUBMITTED' | 'CONFIRMED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IRefundBatch extends Document {
  uploadId: string;
  batchReference: string;
  status: ERefundBatchStatus;
  transactionIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const refundBatchSchema = new Schema<IRefundBatch>(
  {
    uploadId: { type: String, required: true, unique: true },
    batchReference: { type: String, required: true },
    status: {
      type: String,
      enum: ['SUBMITTED', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'SUBMITTED',
    },
    transactionIds: [{ type: String }],
  },
  { timestamps: true },
);

export const RefundBatch = model<IRefundBatch>(EModels.REFUND_BATCH, refundBatchSchema);
