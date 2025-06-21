import { Document, Schema, model } from 'mongoose';
import { EModels } from '../globals';

export interface INotificationInput {
    notificationObject: string;
    notificationMessage: string;
    notifier: string;
    onNotifierModel: string;
}

export interface INotification extends Document {
    notificationObject: Schema.Types.ObjectId;
    read: boolean;
    notifier: Schema.Types.ObjectId;
    notificationMessage: string;
    onNotifierModel: string;
    createdDate: any;
    updatedDate: any;
}

const schema: Schema<INotification> = new Schema({
    notificationObject: {type: Schema.Types.ObjectId, index: true, required: true, ref: EModels.NOTIFICATION_OBJECT},
    read: {type: Boolean, required: true, default: false},
    notifier: {type: Schema.Types.ObjectId, index: true, required: true, refPath: "onNotifierModel"},
    onNotifierModel: {type: String, required: true, enum: [EModels.USER]},
    notificationMessage: {type: String, required: true, trim: true}
}, {
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "updatedDate"
    }
});

export const Notification = model(EModels.NOTIFICATION, schema);