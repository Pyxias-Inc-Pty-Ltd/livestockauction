import { IBidder } from '../models/user-model';
import messageService from '../services/message-service';
import { IMessage, IMessageInput } from '../models/message-model';

export default {
  createChatMessage: async function (socket: any, data: IMessageInput): Promise<IMessage> {
    try {
      const bidder = socket.user as IBidder;

      const message = await messageService.createMessage(bidder, data);

      return message;
    } catch (error) {
      throw error;
    }
  }
} as const;