import { Document, model, Schema } from 'mongoose';
import { EModels } from '../globals';


export interface INotificationObjectInput {
    trigger: string;
    entity: string;
    onEntityModel: string;
}

export interface INotificationObject extends Document {
    trigger: Schema.Types.ObjectId;
    entity: Schema.Types.ObjectId;
    onEntityModel: string
    createdDate: any;
    updatedDate: any;
}

const schema: Schema<INotificationObject> = new Schema({
    trigger: {type: Schema.Types.ObjectId, required: true, ref: EModels.NOTIFICATION_TRIGGER},
    entity: {type: Schema.Types.ObjectId, required: true, refPath: "onEntityModel"},
    onEntityModel: {type: String, required: true, enum: [EModels.USER, EModels.FORUM]}
}, {
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "updatedDate"
    }
});

export const NotificationObject = model(EModels.NOTIFICATION_OBJECT, schema);