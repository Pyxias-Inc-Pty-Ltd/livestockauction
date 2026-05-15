import './pre-start'; // Must be the first import
import logger from 'jet-logger';
import app from './server';
import { connect } from 'mongoose';
import { createServer } from 'http';
import { Server, Socket } from "socket.io";
import StatusCodes from 'http-status-codes';
import { ESocketEventCode, SERVICE_URLS, FIREBASE_SERVICE_ACCOUNT_CREDENTIALS } from './globals';
import bidHandler from './handlers/bid-handler';
import transactionHandler from './handlers/transaction-handler';
import messageHandler from './handlers/message-handler';
import itemHandler from './handlers/item-handler';
import * as admin from 'firebase-admin';
import authHandler from './handlers/auth-handler';
import { CustomError } from './shared/errors';
import { bidQueue } from './queues/bid-queue';
import { startBidWorker } from './workers/bid-worker';
import { startCronJobs } from './cron';
import { IBidder } from './models/user-model';

const { OK, INTERNAL_SERVER_ERROR, CREATED, ACCEPTED } = StatusCodes;

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
    origin: ['http://localhost:5173', SERVICE_URLS.clientURI]
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
  socket.on(ESocketEventCode.JOIN_BIDDING_ROOM, async function (data, cb) {
    try {
      console.log("ESocketEventCode.JOIN_BIDDING_ROOM: ", data);
      bidHandler.joinBiddingRoom(socket, data);
      cb({ status: OK });
      // Broadcast updated connected-bidder count to everyone in the room.
      const room = `${data.lotId}-bid`;
      const sockets = await io.in(room).fetchSockets();
      io.in(room).emit(ESocketEventCode.AUDIENCE_UPDATED, { count: sockets.length });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });

  socket.on('disconnecting', async () => {
    for (const room of socket.rooms) {
      if (room.endsWith('-bid')) {
        const sockets = await io.in(room).fetchSockets();
        // Subtract 1 because this socket is still counted in the room during 'disconnecting'.
        io.in(room).emit(ESocketEventCode.AUDIENCE_UPDATED, { count: sockets.length - 1 });
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
  socket.on(ESocketEventCode.CREATE_NEW_MANUAL_BID_AMOUNT, async function (data, cb) {
    try {
      console.log("ESocketEventCode.CREATE_NEW_MANUAL_BID_AMOUNT: ", data);
      const item = await itemHandler.setNewBidAmountManually(socket, data);
      socket.to(`${item._id.toString()}-bid`).emit(ESocketEventCode.BROADCAST_NEW_MANUAL_BID_AMOUNT, item.manualBidAmount);
      cb({ status: CREATED });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.REFRESH_AFTER_WINNING, async function (data, cb) {
    try {
      console.log("ESocketEventCode.REFRESH_AFTER_WINNING: ", data);
      socket.to(`${data.itemId}-bid`).emit(ESocketEventCode.BROADCAST_REFRESH_AFTER_WINNING, data.itemId);
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
      const bidder = (socket as any).user as IBidder;

      // Enqueue the bid for async processing.
      // The worker processes it and delivers the outcome via the BID_RESULT
      // event to the bidder's private socket room (socket.id).
      const job = await bidQueue.add('bid', {
        socketId: socket.id,
        bidderId: bidder.id.toString(),
        input: data,
      });

      // 202 Accepted: the bid has been queued.
      // The bidder's client should listen for ESocketEventCode.BID_RESULT
      // to learn whether the bid was accepted or rejected.
      cb({ status: ACCEPTED, jobId: job.id });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.RETRACT_BID, async function (data: any, cb: any) {
    try {
      const bid = await bidHandler.retractBid(socket, data);
      console.log("ESocketEventCode.RETRACT_BID: ", data);
      console.log("ESocketEventCode.RETRACTED_BID: ", `${bid.itemId.toString()}-bid`, bid);
      socket.to(`${bid.itemId.toString()}-bid`).emit(ESocketEventCode.RETRACTED_BID, bid.id.toString());
      cb({ status: OK });
    } catch (error) {
      if (error instanceof CustomError) {
        cb({ status: error.HttpStatus, msg: error.message });
      } else {
        cb({ status: INTERNAL_SERVER_ERROR });
      }
    }
  });
  socket.on(ESocketEventCode.MOVE_AUDIENCE_TO_ITEM, async function (data: any, cb: any) {
    try {
      console.log("ESocketEventCode.MOVE_AUDIENCE_TO_ITEM: ", data);
      socket.to(`${data.currentItemId}-bid`).emit(ESocketEventCode.BROADCAST_MOVE_AUDIENCE_TO_ITEM, data.nextitemId);
      cb({ status: OK });
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
    logger.info(SERVICE_URLS.mongoDBURI);
    await connect(SERVICE_URLS.mongoDBURI);
    logger.info('Connection to mongodb established');

    // Start the bid worker.
    // Injecting `io` here avoids a circular import and ensures the worker
    // can broadcast directly to connected sockets.
    startBidWorker(io);
    logger.info('Bid worker started');

    // Start cron jobs (distributed lock via Redis prevents double-execution
    // across multiple instances).
    startCronJobs();

  } catch (error) {
    logger.err(error);
  }
});