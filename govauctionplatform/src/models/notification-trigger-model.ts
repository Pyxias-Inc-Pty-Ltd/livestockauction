import { ConflictError } from '../shared/errors';
import { Document, Schema, model } from 'mongoose';
import { EModels, EPushMessageReason } from '../globals';

export interface INotificationTrigger extends Document {
    name: string;
    description: string;
    createdDate: any;
    updatedDate: any;
}

export interface INotificationTriggerInput {
    name: string;
    description: string;
}

const schema: Schema<INotificationTrigger> = new Schema({
    name: {type: String, required: true, unique: true, trim: true, uppercase: true, enum: [EPushMessageReason.NOTIFY_USER_OF_UPCOMING_AUCTION, EPushMessageReason.NOTIFY_USER_OF_STARTING_AUCTION, EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_RESERVE_PRICE_PAYMENT, EPushMessageReason.NOTIFY_USER_OF_SUCCESSFUL_PURCHASE_PAYMENT, EPushMessageReason.NOTIFY_USER_OF_FORUM_PARTICIPATION]},
    description: {type: String, required: true, trim: true}
}, {
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "updatedDate"
    }
});

schema.post('save', function(error: any, doc: any, next: any) {
    if (error.name === 'MongoServerError' && error.code === 11000) {
        if (error.message.includes('name_1')) {
            next(new ConflictError('A notification trigger with this name already exists'));
        } else {
            next(new ConflictError('Duplicate key error'));
        }
    } else {
        next();
    }
});

export const NotificationTrigger= model(EModels.NOTIFICATION_TRIGGER, schema);