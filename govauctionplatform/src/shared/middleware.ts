import { UnauthorizedError } from '../shared/errors';
import { NextFunction, Request, Response } from 'express';
import { EUserType, EAdminType, KEYCLOAK_CLIENT_ID, KEY_SECRET } from '../globals';
import { IAdmin, IUser } from '../models/user-model';
import { jwtVerify } from 'jose';
import { JWKS, KEYCLOAK_ISSUER } from './keycloak';
import userService from '../services/user-service';

// ---------------------------------------------------------------------------
// Core: deserializeUser
// ---------------------------------------------------------------------------

/**
 * Verify a Keycloak-issued JWT via JWKS, then:
 *  - Attach the matching MongoDB user document to `req.user`
 *  - Attach coarse realm roles to `req.roles`  (realm_access.roles)
 *  - Attach fine-grained permissions to `req.permissions` (resource_access[clientId].roles)
 */
/**
 * Verify a Keycloak-issued JWT (when a Bearer header is present) and attach the
 * matching MongoDB user document to `req.user`, plus realm roles and client
 * permissions. Returns `false` when no Authorization header is present (caller
 * decides whether that is an error), and throws `UnauthorizedError` when a
 * present token is malformed or invalid.
 */
async function tryDeserializeUser(req: Request): Promise<boolean> {
  const bearerHeader = req.headers['authorization'];
  if (!bearerHeader) {
    return false;
  }

  const bearerToken = bearerHeader.split(' ')[1];
  if (!bearerToken) {
    throw new UnauthorizedError('Malformed authorization header');
  }

  // Verify signature, issuer, and audience against Keycloak JWKS endpoint.
  // Enforcing audience ensures only tokens explicitly issued for this API are accepted,
  // rejecting tokens intended for other clients (e.g. the frontend client itself).
  const { payload } = await jwtVerify(bearerToken, JWKS, {
    issuer: KEYCLOAK_ISSUER,
    audience: KEYCLOAK_CLIENT_ID,
  });

  const keycloakId = payload.sub;
  if (!keycloakId) {
    throw new UnauthorizedError('Invalid token: missing sub claim');
  }

  // Populate req.roles from realm_access.roles
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  req.roles = realmAccess?.roles ?? [];

  // Populate req.permissions from resource_access[clientId].roles
  const resourceAccess = payload.resource_access as Record<string, { roles?: string[] }> | undefined;
  req.permissions = resourceAccess?.[KEYCLOAK_CLIENT_ID]?.roles ?? [];

  // Look up local profile by Keycloak user ID (needed for business logic)
  const user = await userService.getByKeycloakId(keycloakId);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  req.user = user;
  return true;
}

/**
 * Require a valid Keycloak JWT: verifies via JWKS, then attaches the matching
 * MongoDB user document to `req.user`, coarse realm roles to `req.roles`, and
 * fine-grained permissions to `req.permissions`. Requests without a token (or
 * with an invalid one) are rejected with 401.
 */
export async function deserializeUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const attached = await tryDeserializeUser(req);
    if (!attached) {
      throw new UnauthorizedError('No token supplied');
    }
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional-auth variant for public routes: attaches `req.user` (plus
 * `req.roles` / `req.permissions`) when a valid Bearer token is present, and
 * proceeds anonymously otherwise. Never rejects the request — callers that use
 * this must not require authentication.
 */
export async function deserializeUserOptional(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await tryDeserializeUser(req);
  } catch {
    // Invalid or malformed token on a public route — continue anonymously.
  }
  next();
}

// ---------------------------------------------------------------------------
// Core: permission / role guards
// ---------------------------------------------------------------------------

/**
 * Require the request to carry ALL of the listed fine-grained permissions
 * (from `req.permissions`, populated via Keycloak client roles).
 *
 * Usage:
 *   router.post('/auction', requirePermission(EPermission.AUCTION_CREATE), handler)
 */
export function requirePermission(...permissions: string[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const missing = permissions.filter((p) => !req.permissions.includes(p));
      if (missing.length > 0) {
        throw new UnauthorizedError(
          `Missing required permission(s): ${missing.join(', ')}`
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require the request to carry AT LEAST ONE of the listed fine-grained permissions.
 *
 * Usage:
 *   router.get('/transactions', requireAnyPermission(EPermission.TRANSACTION_READ, EPermission.USER_MANAGE), handler)
 */
export function requireAnyPermission(...permissions: string[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const hasAny = permissions.some((p) => req.permissions.includes(p));
      if (!hasAny) {
        throw new UnauthorizedError(
          `Requires at least one of: ${permissions.join(', ')}`
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require the request to carry a specific coarse realm role
 * (from `req.roles`, populated via Keycloak realm_access.roles).
 *
 * Prefer `requirePermission` for new routes; use this only when a coarse
 * role check is sufficient and no client-level permissions are configured.
 */
export function requireRole(role: string, errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.roles.includes(role)) {
        throw new UnauthorizedError(
          errorMessage ?? `Requires role: ${role}`
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require the request to carry AT LEAST ONE of the listed coarse realm roles.
 */
export function requireAnyRole(roles: string[], errorMessage?: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const hasAny = roles.some((r) => req.roles.includes(r));
      if (!hasAny) {
        throw new UnauthorizedError(
          errorMessage ?? `Requires one of roles: ${roles.join(', ')}`
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Legacy role aliases — kept for backwards compatibility.
// These delegate to requireRole/requireAnyRole (JWT-sourced, no DB check,
// no NODE_ENV bypass, no isSkippable hack).
// ---------------------------------------------------------------------------

/** Allow only SUPER_ADMIN realm role. */
export function SuperAdminOnly(errorMessage?: string) {
  return requireRole(EAdminType.SUPER, errorMessage ?? `Admin must be of type ${EAdminType.SUPER}`);
}

/** Allow only SELLER realm role. */
export function SellerOnly(errorMessage?: string) {
  return requireRole(EUserType.SELLER, errorMessage ?? `User must be of type ${EUserType.SELLER}`);
}

/** Allow only BIDDER realm role. */
export function BidderOnly(errorMessage?: string) {
  return requireRole(EUserType.BIDDER, errorMessage ?? `User must be of type ${EUserType.BIDDER}`);
}

/** Allow only AUCTION_APPROVER realm role. */
export function AuctionApproverOnly(errorMessage?: string) {
  return requireRole(EUserType.AUCTION_APPROVER, errorMessage ?? `User must be of type ${EUserType.AUCTION_APPROVER}`);
}

/**
 * Allow SUPER_ADMIN, SELLER, or AUCTION_APPROVER realm roles.
 * @deprecated Prefer requireAnyRole or requireAnyPermission with explicit permissions.
 */
export function AnyAdminMiddleware(errorMessage?: string) {
  return requireAnyRole(
    [EAdminType.SUPER, EUserType.SELLER, EUserType.AUCTION_APPROVER],
    errorMessage ?? 'You do not have permission to access this resource.',
  );
}

// ---------------------------------------------------------------------------
// Queue service auth
// ---------------------------------------------------------------------------

/**
 * Validate x-api-key header against KEY_SECRET for queue service calls.
 * Rejects requests that present an x-api-key header with the wrong value.
 * If no x-api-key header is present, passes through (for normal JWT auth).
 */
export function requireQueueApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];
  if (apiKey === undefined) {
    return next(); // no header — fall through to JWT
  }
  if (apiKey !== KEY_SECRET) {
    throw new UnauthorizedError('Invalid x-api-key');
  }
  next();
}
