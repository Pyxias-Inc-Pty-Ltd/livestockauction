import { Router } from 'express';
import userRouter from '../user-router';
import bidRouter from '../bid-router';
import itemRouter from '../item-router';
import transactionRouter from '../transaction-router';
import categoryRouter from '../category-router';
import auctionRouter from '../auction-router';
import forumRouter from '../forum-router';
import notificationTriggerRouter from '../notification-trigger-router';
import notificationRouter from '../notification-router';

// Export the base-router
const baseRouter = Router();

// Setup routers
baseRouter.use('/bids', bidRouter);
baseRouter.use('/items', itemRouter);
baseRouter.use('/auctions', auctionRouter);
baseRouter.use('/users', userRouter);
baseRouter.use('/transactions', transactionRouter);
baseRouter.use('/categories', categoryRouter);
baseRouter.use('/forums', forumRouter);
baseRouter.use('/notificationTriggers', notificationTriggerRouter);
baseRouter.use('/notifications', notificationRouter);

// Export default.
export default baseRouter;