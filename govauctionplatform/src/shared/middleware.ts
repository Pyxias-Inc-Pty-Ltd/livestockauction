import { UnauthorizedError } from '../shared/errors';
import { NextFunction, Request, Response } from 'express';
import { ENVIRONMENT_PRODUCTION, EUserType, EAdminType, fauxObject, STATE_JWT_SECRET } from '../globals';
import { IAdmin, IUser } from '../models/user-model';
import { verify } from 'jsonwebtoken';
import userService from '../services/user-service';

/**
 * Check if current user is a super admin
 *
 * @param errorMessage
 * @returns
 */
export function SuperAdminOnly(errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      if (process.env.NODE_ENV === ENVIRONMENT_PRODUCTION) {
        if ((((req as any).user as IUser).userType !== 'ADMIN') && (((req as any).user as IAdmin).adminType !== 'SUPER')) {
          if (!res.locals.isSkippable) {
            if (errorMessage) {
              throw new UnauthorizedError(errorMessage);
            } else {
              throw new UnauthorizedError(`Admin must be of type ${EAdminType.SUPER}`);
            }
          }
        } else {
          res.locals.isSkippable = true;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}

/**
 * Check if current user is a bidder
 * 
 * @returns 
 */
export function BidderOnly(errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      if (process.env.NODE_ENV === ENVIRONMENT_PRODUCTION) {
        if (((req as any).user as IUser).userType !== 'BIDDER') {
          if (!res.locals.isSkippable) {
            if (errorMessage) {
              throw new UnauthorizedError(errorMessage);
            } else {
              throw new UnauthorizedError(`User must be of type ${EUserType.BIDDER}`);
            }
          }
        } else {
          res.locals.isSkippable = true;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}

/**
 * Check if current user is a seller
 * 
 * @returns 
 */
export function SellerOnly(errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      if (process.env.NODE_ENV === ENVIRONMENT_PRODUCTION) {
        if (((req as any).user as IUser).userType !== 'SELLER') {
          if (!res.locals.isSkippable) {
            if (errorMessage) {
              throw new UnauthorizedError(errorMessage);
            } else {
              throw new UnauthorizedError(`User must be of type ${EUserType.SELLER}`);
            }
          }
        } else {
          res.locals.isSkippable = true;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}

/**
 * Verify jwt and return user.
 * 
 * @returns 
 */
export async function deserializeUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    
    const bearerHeader = req.headers['authorization'];

    if (bearerHeader) {

      // Split
      const bearer = bearerHeader.split(' ');

      // Get token
      const bearerToken = bearer[1];

      // Verify and decode token
      const verifiedToken = verify(bearerToken, STATE_JWT_SECRET);
      let _decodedToken: fauxObject = {};

      if (typeof verifiedToken === 'string') {
        _decodedToken = JSON.parse(verifiedToken);
      } else {
        _decodedToken = verifiedToken;
      }

      // Check if exists
      if (!_decodedToken.subject) {
        throw new UnauthorizedError('Invalid token');
      }

      // Find user
      const user = await userService.getById(_decodedToken.subject);

      if (user) {
        // Set user on request object
        req.user = user;
      } else {
        throw new UnauthorizedError('Invalid token');
      }

      next();

    } else {
      throw new UnauthorizedError('No token supplied');
    }

  } catch (error) {
    next(error);
  }
}