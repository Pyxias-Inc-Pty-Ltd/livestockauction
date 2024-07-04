import { Router } from 'express';
import openRouter from '../open-router';

// Export the base-router
const baseRouter = Router();

// Setup routers
baseRouter.use(openRouter);

// Export default.
export default baseRouter;
