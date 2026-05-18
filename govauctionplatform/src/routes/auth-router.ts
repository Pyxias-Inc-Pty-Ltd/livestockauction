import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID } from '../globals';
import { exchangeCodeForTokens, refreshAccessToken, revokeToken } from '../shared/keycloak';

const router = Router();
const { OK, UNAUTHORIZED } = StatusCodes;

// ---------------------------------------------------------------------------
// Refresh-token cookie
// ---------------------------------------------------------------------------
const COOKIE_NAME = 'rt';
// The backend is always served over HTTPS (Railway), and the frontend may be
// on a different origin (localhost in dev, gov.bw in prod). SameSite=None is
// required for the httpOnly cookie to be sent on cross-origin XHR requests
// (e.g. POST /auth/refresh). Secure is required whenever SameSite=None is set.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
export const p = {
  config:   '/config',
  exchange: '/exchange',
  refresh:  '/refresh',
  logout:   '/logout',
} as const;

// ---------------------------------------------------------------------------
// GET /auth/config
// Returns Keycloak endpoint information for API clients.
// ---------------------------------------------------------------------------
router.get(p.config, (_req: Request, res: Response) => {
  const realm = KEYCLOAK_REALM ?? 'auctions';
  const base = `${KEYCLOAK_URL}/realms/${realm}`;
  return res.status(OK).json({
    realm,
    clientId: KEYCLOAK_CLIENT_ID,
    tokenEndpoint:         `${base}/protocol/openid-connect/token`,
    authorizationEndpoint: `${base}/protocol/openid-connect/auth`,
    logoutEndpoint:        `${base}/protocol/openid-connect/logout`,
    discoveryDocument:     `${base}/.well-known/openid-configuration`,
  });
});

// ---------------------------------------------------------------------------
// POST /auth/exchange
// PKCE code exchange (BFF pattern).
// Frontend sends { code, codeVerifier, redirectUri }.
// Backend exchanges with Keycloak, stores refresh token in httpOnly cookie,
// and returns the short-lived access token in the response body.
// ---------------------------------------------------------------------------
router.post(p.exchange, async (req: Request, res: Response) => {
  const schema = Joi.object({
    code:        Joi.string().required(),
    codeVerifier: Joi.string().required(),
    redirectUri: Joi.string().uri().required(),
  }).required();
  Joi.assert(req.body, schema);

  const { code, codeVerifier, redirectUri } = req.body;
  const { accessToken, refreshToken } = await exchangeCodeForTokens(code, codeVerifier, redirectUri);

  res.cookie(COOKIE_NAME, refreshToken, cookieOptions);
  return res.status(OK).json({ accessToken });
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
// Silent token refresh using the httpOnly cookie.
// Returns a new access token; rotates the refresh token cookie.
// ---------------------------------------------------------------------------
router.post(p.refresh, async (req: Request, res: Response) => {
  const refreshToken = (req as any).cookies?.[COOKIE_NAME];
  if (!refreshToken) {
    return res.status(UNAUTHORIZED).json({ error: 'No refresh token' });
  }

  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);
  res.cookie(COOKIE_NAME, newRefreshToken, cookieOptions);
  return res.status(OK).json({ accessToken });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// Revokes the refresh token at Keycloak and clears the httpOnly cookie.
// ---------------------------------------------------------------------------
router.post(p.logout, async (req: Request, res: Response) => {
  const refreshToken = (req as any).cookies?.[COOKIE_NAME];
  if (refreshToken) {
    try {
      await revokeToken(refreshToken);
    } catch {
      // Best-effort revocation — always clear the cookie
    }
  }
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  return res.status(OK).json({ message: 'Logged out' });
});

export default router;
