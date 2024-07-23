import { Document, Schema, model } from 'mongoose';
import { EModels } from '../globals';

export interface INotificationChangeInput {
    notificationObject: string;
    actor: string;
    onActorModel: string;
}

export interface INotificationChange extends Document {
    notificationObject: Schema.Types.ObjectId;
    read: boolean
    actor: Schema.Types.ObjectId;
    onActorModel: string;
    createdDate: any;
    updatedDate: any;
}

const schema: Schema<INotificationChange> = new Schema({
    notificationObject: {type: Schema.Types.ObjectId, required: true, index: true, ref: EModels.NOTIFICATION_OBJECT},
    read: {type: Boolean, required: true, default: false},
    actor: {type: Schema.Types.ObjectId, index:true, required: true, refPath: "onActorModel"},
    onActorModel: {type: String, required: true, enum: [EModels.USER]}
}, {
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "updatedDate"
    }
});

export const NotificationChange = model(EModels.NOTIFICATION_CHANGE, schema);