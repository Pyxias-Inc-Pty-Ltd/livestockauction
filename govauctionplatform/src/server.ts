import morgan from 'morgan';
import helmet from 'helmet';

import express, { NextFunction, Request, Response } from 'express';
import StatusCodes from 'http-status-codes';
import 'express-async-errors';

import cors from "cors";
import appRouter from './routes/main/app';
import authRouter from './routes/main/auth';
import openRouter from './routes/main/open';
import logger from 'jet-logger';
import passport from 'passport';
import { CustomError } from './shared/errors';
import { ENVIRONMENT_PRODUCTION } from './globals';
import { deserializeUser } from './shared/middleware';


// Constants
const app = express();

/***********************************************************************************
 *                                  Middlewares
 **********************************************************************************/

// Common middlewares

// TODO: Configure PRE-FLIGHT CORS (Set allowed origins)
app.use(cors({origin: ['http://localhost:5173', 'https://livestock-auction-demo.netlify.app','https://auctiondev.xyz'], credentials: true}));
app.use(express.json());
app.use(express.urlencoded({extended: true}));

// Show routes called in console during development
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Security (helmet recommended in express docs)
if (process.env.NODE_ENV === ENVIRONMENT_PRODUCTION) {
  app.use(helmet());
}

/***********************************************************************************
 *                         Routers and error handling
 **********************************************************************************/

// TODO: Check auth token scope if APP, OPEN or API

// Add auth router
app.use('/auth', authRouter);
// Add open router
app.use('/open', openRouter);

app.use(passport.initialize());

// Add app router
app.use('/app', deserializeUser, appRouter);

// Error handling
app.use((err: Error | CustomError, _: Request, res: Response, __: NextFunction) => {
  logger.err(err, true);
  const status = (err instanceof CustomError ? err.HttpStatus : StatusCodes.BAD_REQUEST);
  return res.status(status).json({
    error: err.message,
  });
});

// Export here and start in a diff file (for testing).
export default app;
