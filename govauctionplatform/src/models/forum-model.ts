import { Schema, model, Document } from 'mongoose';
import { EModels } from '../globals';

export interface IForumComment extends Document {
    forumId: Schema.Types.ObjectId;
    authorId: Schema.Types.ObjectId;
    content: string;
    createdDate: Date;
    updatedDate: Date;
}

export interface IForum extends Document {
    auctionId: Schema.Types.ObjectId;
    participants: Array<Schema.Types.ObjectId>;
    createdDate: Date;
    updatedDate: Date;
}

export interface IForumInput {
    auctionId: Schema.Types.ObjectId;
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
    participants: [{ type: Schema.Types.ObjectId, ref: EModels.USER }]
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
forumSchema.post('save', function(doc) {
    console.log(`Forum with ID ${doc._id} was saved.`);
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
