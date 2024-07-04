import { Router } from 'express';
import authRouter from '../auth-router';

// Export the base-router
const baseRouter = Router();

// Setup routers
baseRouter.use(authRouter);

// Export default.
export default baseRouter;
