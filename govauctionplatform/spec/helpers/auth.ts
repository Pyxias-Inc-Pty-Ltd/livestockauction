import { generateKeyPairSync } from 'crypto';
import { SignJWT } from 'jose';
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { IUser } from '../../src/models/user-model';

// ---------------------------------------------------------------------------
// Test RSA key pair — generated once per process, reused across all test files
// ---------------------------------------------------------------------------

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const TEST_ISSUER = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`;

/**
 * Sign a JWT with the test RSA private key.
 *
 * Intended for auth-router tests where the full token-verification path is
 * exercised. Those tests must also mock `JWKS` in `src/shared/keycloak` to
 * use the corresponding public key (see auth-router.spec.ts for the pattern).
 *
 * For all other route tests, prefer `mockDeserializeUser` instead — it is
 * faster and avoids the JWKS mock setup.
 */
export async function signTestToken(
  permissions: string[],
  roles: string[],
  sub: string = new Types.ObjectId().toHexString(),
): Promise<string> {
  return new SignJWT({
    sub,
    realm_access: { roles },
    resource_access: {
      [process.env.KEYCLOAK_CLIENT_ID!]: { roles: permissions },
    },
    aud: process.env.KEYCLOAK_CLIENT_ID,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(TEST_ISSUER)
    .setExpirationTime('1h')
    .sign(privateKey);
}

/**
 * Returns an Express middleware that bypasses Keycloak JWT verification and
 * directly injects `user`, `roles`, and `permissions` onto `req`.
 *
 * Use this to mock `deserializeUser` in integration route tests so that
 * tests focus on handler/service logic rather than auth plumbing.
 *
 * @example
 * ```ts
 * jest.mock('../../src/shared/middleware', () => ({
 *   ...jest.requireActual('../../src/shared/middleware'),
 *   deserializeUser: mockDeserializeUser(seedUser, ['BIDDER'], ['lot:bid']),
 * }));
 * ```
 */
export function mockDeserializeUser(
  user: Partial<IUser>,
  roles: string[],
  permissions: string[],
) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    _req.user = user as IUser;
    _req.roles = roles;
    _req.permissions = permissions;
    next();
  };
}
