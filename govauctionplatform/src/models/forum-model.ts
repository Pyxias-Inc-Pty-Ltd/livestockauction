import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';
import { IAuction } from './auction-model';
import { firebase } from '../index';
import { NotFoundError } from '../shared/errors';

export interface IForumComment extends Document {
    forumId: Schema.Types.ObjectId;
    authorId: Schema.Types.ObjectId;
    content: string;
    createdDate: Date;
    updatedDate: Date;
}

export interface IForum extends Document {
    auctionId: Schema.Types.ObjectId;
    participants: Array<string>;
    createdDate: Date;
    updatedDate: Date;
}

export interface IForumInput {
  auctionId: Schema.Types.ObjectId;
  participants?: Array<string>;
}

export interface IForumCommentInput {
    forumId: Schema.Types.ObjectId;
    authorId: Schema.Types.ObjectId;
    content: string;
}

const forumCommentSchema = new Schema<IForumComment>({
    forumId: { type: Schema.Types.ObjectId, required: true, ref: EModels.FORUM },
    authorId: { type: Schema.Types.ObjectId, required: true, ref: EModels.USER },
    content: { type: String, required: true, trim: true }
}, {
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "updatedDate"
    }
});

// Pre-save hook for forumCommentSchema
forumCommentSchema.pre('save', async function(next) {
    if (this.isModified('content') && !this.isNew) {
        this.updatedDate = new Date();
    }
    next();
});

// Post-save hook for forumCommentSchema
forumCommentSchema.post('save', function(doc) {
    console.log(`Forum comment with ID ${doc._id} was saved.`);
});

const forumSchema = new Schema<IForum>({
    auctionId: { type: Schema.Types.ObjectId, required: true, ref: EModels.AUCTION },
    participants: [{ type: String }]
}, {
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "updatedDate"
    }
});

// Pre-save hook for forumSchema
forumSchema.pre('save', async function(next) {
    if (this.isModified('participants') && !this.isNew) {
        this.updatedDate = new Date();
    }
    next();
});

// Post-save hook for forumSchema
forumSchema.post('save', async function(doc) {
    try {
        // Fetch the new participants
        const newParticipants = doc.participants;
        
        // Fetch the users' Firebase tokens

        const [ auction, users ] = await Promise.all([doc.$model(EModels.AUCTION).findById(doc.auctionId, { name: 1 }), doc.$model(EModels.USER).find({ _id: { $in: newParticipants } }).select('firebaseTokenId').exec()]);

        if (!auction) {
          throw new NotFoundError('Auction not found');
        }

        const tokens = users.map((user: any) => user.firebaseTokenId).filter(token => token);

        // Construct message
        const message = {
            notification: {
                title: 'Added to a Forum',
                body: `You have been added to the forum: "${(auction as IAuction).title}"`
            },
            tokens: tokens
        };

        // Send notifications
        if (tokens.length > 0) {
            const response = await firebase.messaging().sendEachForMulticast(message);
            console.log('Successfully sent notifications:', response);
        } else {
            console.log('No tokens available to send notifications.');
        }
    } catch (error) {
        console.error('Error sending notification:', error);
    }
});

forumSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        delete ret._id;
        delete ret.__t;
    }
});

export const Forum = model<IForum>(EModels.FORUM, forumSchema);
export const ForumComment = model<IForumComment>(EModels.FORUM_COMMENT, forumCommentSchema);
