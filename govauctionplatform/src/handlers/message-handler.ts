import { IAdmin, IBidder } from '../models/user-model';
import messageService from '../services/message-service';
import { IMessage, IMessageInput } from '../models/message-model';
import { IForumComment, IForumCommentInput } from '../models/forum-model';
import forumService from '../services/forum-service';

export default {
  createChatMessage: async function (socket: any, data: IMessageInput): Promise<IMessage> {
    try {
      const actor = socket.user as IBidder | IAdmin;

      const message = await messageService.createMessage(actor, data);

      return message;
    } catch (error) {
      throw error;
    }
  },
  createForumComment: async function (socket: any, data: IForumCommentInput): Promise<IForumComment> {
    try {
      const actor = socket.user as IBidder | IAdmin;

      const comment = await forumService.createForumComment(actor, data);

      return comment;
    } catch (error) {
      throw error;
    }
  }
} as const;