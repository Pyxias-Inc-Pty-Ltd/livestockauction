import './pre-start'; // Must be the first import 
import logger from 'jet-logger';
import app from './server';
import { connect } from 'mongoose';
import { createServer } from 'http';
import { Server, Socket } from "socket.io";
import StatusCodes from 'http-status-codes';
import { ESocketEventCode, SERVICE_URLS, FIREBASE_SERVICE_ACCOUNT_CREDENTIALS} from './globals';
import bidHandler from './handlers/bid-handler';
import transactionHandler from './handlers/transaction-handler';
import messageHandler from './handlers/message-handler';
import * as admin from 'firebase-admin';
import authHandler from './handlers/auth-handler';
import { CustomError } from './shared/errors';

const { OK, INTERNAL_SERVER_ERROR, CREATED } = StatusCodes;

// Constants
const serverStartMsg = 'Express server started on port: ',
  port = (process.env.PORT || 3000);

// Init firebase
export const firebase = admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT_CREDENTIALS))
});

const httpServer = createServer(app);

// Init socket.io
export const io = new Server(httpServer, { 
  cors: {
    credentials: true,
    origin: ['http://localhost:5173', 'https://livestock-auction-demo.netlify.app', SERVICE_URLS.clientURI]
  }
});



// Check for auth on handshake
io.use(async (socket: any, next: any) => {
  try {
    await authHandler.deserializeUser(socket, socket.handshake.auth.authorization);
    next();
  } catch (error) {
    next(error);
  }
});

const onConnection = (socket: Socket) => {
  console.log('a user connected: ', socket.id);
  socket.on(ESocketEventCode.JOIN_BIDDING_ROOM, function (data, cb) {
    try {
      console.log("ESocketEventCode.JOIN_BIDDING_ROOM: ", data);
      bidHandler.joinBiddingRoom(socket, data);
      cb({ status: OK });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.POLL_PAID_TRANSACTION, async function (data, cb) {
    try {
      console.log("ESocketEventCode.POLL_PAID_TRANSACTION: ", data);
      const result = await transactionHandler.pollPaidTransaction(socket, data);
      cb({ status: OK, result });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.JOIN_BIDDING_ROOM_CHAT, function (data, cb) {
    try {
      bidHandler.joinBiddingRoomChat(socket, data);
      cb({ status: OK });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.CREATE_CHAT_MESSAGE, async function (data, cb) {
    try {
      console.log("ESocketEventCode.CREATE_CHAT_MESSAGE: ", data);
      const message = await messageHandler.createChatMessage(socket, data);
      socket.to(`${message.adminId}-${message.bidderId}-chat`).emit(ESocketEventCode.BROADCAST_CHAT_MESSAGE, JSON.stringify(message));
      cb({ status: CREATED });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.CREATE_FORUM_COMMENT, async function (data, cb) {
    try {
      console.log("ESocketEventCode.CREATE_FORUM_COMMENT: ", data);
      const comment = await messageHandler.createForumComment(socket, data);
      socket.to(`${comment.forumId}-forum`).emit(ESocketEventCode.BROADCAST_FORUM_COMMENT, JSON.stringify(comment));
      cb({ status: CREATED });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.CREATE_BID, async function (data: any, cb: any) {
    try {
      const bid = await bidHandler.createBid(socket, data);
      console.log("ESocketEventCode.CREATE_BID: ", data);
      console.log("ESocketEventCode.CREATED_BID: ", `${bid.itemId.toString()}-bid`, bid);
      socket.to(`${bid.itemId.toString()}-bid`).emit(ESocketEventCode.UPDATE_BID_AMOUNT, bid.bidAmount);
      cb({ status: CREATED });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
};

// Listen for events
io.on("connection", onConnection);

// Connection error handling
io.engine.on("connection_error", (err: any) => {
  logger.err(err.req);      // the request object
  logger.err(err.code);     // the error code, for example 1
  logger.err(err.message);  // the error message, for example "Session ID unknown"
  logger.err(err.context);  // some additional error context
});

// Start server
httpServer.listen(port, async () => {
  try {
    logger.info(serverStartMsg + port);

    // Start connection to mongodb
    await connect(SERVICE_URLS.mongoDBURI);
    logger.info('Connection to mongodb established');
    
  } catch (error) {
    logger.err(error);
  }
});