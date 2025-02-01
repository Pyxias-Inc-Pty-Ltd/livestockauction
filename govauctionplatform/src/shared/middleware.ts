import { UnauthorizedError } from '../shared/errors';
import { NextFunction, Request, Response } from 'express';
import { ENVIRONMENT_PRODUCTION, EUserType, EAdminType, fauxObject, STATE_JWT_SECRET } from '../globals';
import { IAdmin, IUser } from '../models/user-model';
import { verify } from 'jsonwebtoken';
import userService from '../services/user-service';

/**
 * Middleware to allow access if the user is a SUPER_ADMIN, SELLER, or AUCTION_APPROVER.
 * 
 * @param errorMessage
 * @return Middleware function
 */
export function AnyAdminMiddleware(errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user as IUser;

      // Check if the user has any of the required roles
      if (
        (user.userType === 'ADMIN' && (user as IAdmin).adminType === 'SUPER') ||
        user.userType === 'SELLER' ||
        user.userType === EUserType.AUCTION_APPROVER
      ) {
        next(); // Allow access
      } else {
        // Deny access if the user doesn't have any of the required roles
        throw new UnauthorizedError(errorMessage || 'You do not have permission to access this resource.');
      }
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Check if current user is a super admin
 *
 * @param errorMessage
 * @return Middleware function
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
 * @return Middleware function
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
 * @return Middleware function
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
 * Check if current user is an auction approver
 * 
 * @param errorMessage Optional custom error message
 * @return Middleware function
 */
export function AuctionApproverOnly(errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      if (process.env.NODE_ENV === ENVIRONMENT_PRODUCTION) {
        if (((req as any).user as IUser).userType !== EUserType.AUCTION_APPROVER) {
          if (!res.locals.isSkippable) {
            if (errorMessage) {
              throw new UnauthorizedError(errorMessage);
            } else {
              throw new UnauthorizedError(`User must be of type ${EUserType.AUCTION_APPROVER}`);
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