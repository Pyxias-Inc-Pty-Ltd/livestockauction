import { Schema, model, Document } from 'mongoose';
import { addedToForumTemplate, EModels, EPushMessageReason, EUserType, ID_VERIFICATION_API_KEY, SERVICE_URLS } from '../globals';
import { IAuction } from './auction-model';
import { firebase } from '../index';
import { InternalServerError, NotFoundError } from '../shared/errors';
import { IBidder } from './user-model';
import * as axios from 'axios';

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
    if (!this.isNew) {
      const originalDocument = await this.$model(EModels.FORUM).findById(this._id, { participants: 1 });
      // Check if exists
      if (!originalDocument) {
        throw new NotFoundError('Forum not found');
      }

      this.$locals.originalParticipants = (originalDocument as any).participants;
    }
    if (this.isModified('participants') && !this.isNew) {
        this.updatedDate = new Date();
    }
    next();
});

// Post-save hook for forumSchema
forumSchema.post('save', async function(doc) {
  try {
      const originalParticipants = this.$locals.originalParticipants as Array<string> || [];

      // Fetch the new participants
      const newParticipants = doc.participants;
      const addedParticipants = newParticipants.filter(p => !originalParticipants.includes(p));

      if (addedParticipants.length > 0) {
        if (!doc.$session()) {
          throw new InternalServerError('A mongodb session is required on the forum-model post save hook');
        }

        const sess = doc.$session();
        const userId = addedParticipants[addedParticipants.length - 1];
      
        const [ auction, user, notificationTrigger ] = await Promise.all([
          doc.$model(EModels.AUCTION).findById(doc.auctionId, { name: 1 }), 
          doc.$model(EModels.USER).findById(userId, { firebaseTokenId: 1, email: 1, userType: 1 }), 
          doc.$model(EModels.NOTIFICATION_TRIGGER).findOne(
            { name: EPushMessageReason.NOTIFY_USER_OF_FORUM_PARTICIPATION }, 
            { _id: 1 }
          )
        ]);

        if (!auction) {
          throw new NotFoundError('Auction not found');
        }

        if (!notificationTrigger) {
          throw new InternalServerError('Notification trigger not found');
        }

        if (!user) {
          throw new InternalServerError('User not found');
        }

        // Check if admin
        if ((user as any).userType !== EUserType.ADMIN) {
          const email = (user as IBidder).email;

          // Create notification object
          const newNotificationObject = await doc.$model(EModels.NOTIFICATION_OBJECT).create({
            trigger: notificationTrigger.id,
            entity: doc.id,
            onEntityModel: EModels.FORUM
          }, { session: sess });

          // Create notification change
          await doc.$model(EModels.NOTIFICATION_CHANGE).create({
            notificationObject: (newNotificationObject as any).id,
            actor: userId,
            onActorModel: EModels.USER
          }, { session: sess });

          const notificationMessage = `You have been added to the forum: "${(auction as IAuction).title}"`;

          // Create notification
          await doc.$model(EModels.NOTIFICATION).create({
            notificationObject: (newNotificationObject as any).id,
            notifier: userId,
            onNotifierModel: EModels.USER,
            notificationMessage
          }, { session: sess });

          const title = 'Added to a Forum';
          const htmlContent = addedToForumTemplate
            .replace('[UserName]', (user as IBidder).isOrganization ? (user as IBidder).name as string : (user as IBidder).firstName as string)
            .replace('[AuctionName]', (auction as IAuction).title);

          // Queue the email
          await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
            data: {
              subject: title,
              email,
              message: htmlContent
            }
          }, {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": ID_VERIFICATION_API_KEY
            }
          });

          // Check for firebase token
          if ((user as any).firebaseTokenId) {
            // Construct message
            const message = {
              data: {
                pmr: EPushMessageReason.NOTIFY_USER_OF_FORUM_PARTICIPATION
              },
              notification: {
                title,
                body: notificationMessage
              },
              token: (user as any).firebaseTokenId
            };
            await firebase.messaging().send(message);
          }
        }
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
