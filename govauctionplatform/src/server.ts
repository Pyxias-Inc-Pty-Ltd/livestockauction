import morgan from 'morgan';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import express, { NextFunction, Request, Response } from 'express';
import StatusCodes from 'http-status-codes';
import 'express-async-errors';

import cors from "cors";
import appRouter from './routes/main/app';
import authRouter from './routes/main/auth';
import openRouter from './routes/main/open';
import logger from 'jet-logger';
import { CustomError } from './shared/errors';
import { ENVIRONMENT_PRODUCTION, SERVICE_URLS } from './globals';
import { deserializeUser } from './shared/middleware';


// Constants
const app = express();

/***********************************************************************************
 *                                  Middlewares
 **********************************************************************************/

// TODO: Configure PRE-FLIGHT CORS (Set allowed origins)
app.use(cors({origin: ['http://localhost:5173', SERVICE_URLS.clientURI], credentials: true}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Auth discovery endpoint (no JWT required)
app.use('/auth', authRouter);
// Public endpoints (no JWT required)
app.use('/open', openRouter);

// Protected endpoints — Keycloak JWT verified by deserializeUser
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
