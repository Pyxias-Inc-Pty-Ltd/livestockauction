/**
 * auth-router integration tests.
 *
 * Covers the four BFF auth endpoints:
 *   GET  /config
 *   POST /exchange  — PKCE code → tokens, refresh token stored in httpOnly cookie
 *   POST /refresh   — silent refresh via httpOnly cookie
 *   POST /logout    — revoke + clear cookie
 *
 * No database is needed; all Keycloak I/O is mocked at the module level.
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('../../../src/shared/keycloak', () => ({
  exchangeCodeForTokens: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeToken: jest.fn(),
  // JWKS and KEYCLOAK_ISSUER are used only by deserializeUser, not auth-router.
  JWKS: undefined,
  KEYCLOAK_ISSUER: 'https://keycloak.test/realms/auctions',
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import 'express-async-errors';
import request from 'supertest';
import { exchangeCodeForTokens, refreshAccessToken, revokeToken } from '../../../src/shared/keycloak';
import { CustomError } from '../../../src/shared/errors';
import authRouter from '../../../src/routes/auth-router';

// ─── Test app ─────────────────────────────────────────────────────────────────

/**
 * Minimal express app — mirrors the auth slice of server.ts.
 * Built once; reused across all tests (no side-effects between requests).
 */
function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(authRouter);
  // Mirror the server.ts error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof CustomError ? err.HttpStatus : 400;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const app = buildTestApp();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_EXCHANGE_BODY = {
  code: 'auth-code-abc',
  codeVerifier: 'code-verifier-xyz',
  redirectUri: 'http://localhost:5173/callback',
};

/** Extract the rt cookie string from a supertest response. */
function getRtCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  return cookies.find((c) => c.startsWith('rt='));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('auth-router', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── GET /config ───────────────────────────────────────────────────────────

  describe('GET /config', () => {
    it('returns 200 with Keycloak configuration fields', async () => {
      const res = await request(app).get('/config');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        realm: expect.any(String),
        clientId: expect.any(String),
        tokenEndpoint: expect.stringContaining('/protocol/openid-connect/token'),
        authorizationEndpoint: expect.stringContaining('/protocol/openid-connect/auth'),
        logoutEndpoint: expect.stringContaining('/protocol/openid-connect/logout'),
        discoveryDocument: expect.stringContaining('/.well-known/openid-configuration'),
      });
    });
  });

  // ─── POST /exchange ────────────────────────────────────────────────────────

  describe('POST /exchange', () => {
    it('returns 200 with accessToken and sets an rt httpOnly cookie', async () => {
      (exchangeCodeForTokens as jest.Mock).mockResolvedValueOnce({
        accessToken: 'fake-at',
        refreshToken: 'fake-rt',
      });

      const res = await request(app).post('/exchange').send(VALID_EXCHANGE_BODY);

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe('fake-at');
      const rt = getRtCookie(res);
      expect(rt).toBeDefined();
    });

    it('stores the refresh token as an httpOnly cookie (never in body)', async () => {
      (exchangeCodeForTokens as jest.Mock).mockResolvedValueOnce({
        accessToken: 'at',
        refreshToken: 'secret-refresh-token',
      });

      const res = await request(app).post('/exchange').send(VALID_EXCHANGE_BODY);

      // Refresh token must not appear anywhere in the response body
      expect(JSON.stringify(res.body)).not.toContain('secret-refresh-token');
      // But it must be in the Set-Cookie header
      expect(getRtCookie(res)).toContain('secret-refresh-token');
    });

    it('rt cookie has HttpOnly, Path=/auth, SameSite=Strict flags', async () => {
      (exchangeCodeForTokens as jest.Mock).mockResolvedValueOnce({
        accessToken: 'at',
        refreshToken: 'rt-value',
      });

      const res = await request(app).post('/exchange').send(VALID_EXCHANGE_BODY);
      const rt = getRtCookie(res)!;

      expect(rt).toMatch(/HttpOnly/i);
      expect(rt).toContain('Path=/auth');
      expect(rt).toMatch(/SameSite=Strict/i);
    });

    it('calls exchangeCodeForTokens with the correct arguments', async () => {
      (exchangeCodeForTokens as jest.Mock).mockResolvedValueOnce({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      await request(app).post('/exchange').send(VALID_EXCHANGE_BODY);

      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        'auth-code-abc',
        'code-verifier-xyz',
        'http://localhost:5173/callback'
      );
    });

    it('returns 400 when code is missing', async () => {
      const { code: _omitted, ...body } = VALID_EXCHANGE_BODY;
      const res = await request(app).post('/exchange').send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when codeVerifier is missing', async () => {
      const { codeVerifier: _omitted, ...body } = VALID_EXCHANGE_BODY;
      const res = await request(app).post('/exchange').send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when redirectUri is missing', async () => {
      const { redirectUri: _omitted, ...body } = VALID_EXCHANGE_BODY;
      const res = await request(app).post('/exchange').send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when redirectUri is not a valid URI', async () => {
      const res = await request(app).post('/exchange').send({
        ...VALID_EXCHANGE_BODY,
        redirectUri: 'not-a-uri',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when Keycloak rejects the code', async () => {
      (exchangeCodeForTokens as jest.Mock).mockRejectedValueOnce(
        new Error('invalid_grant')
      );

      const res = await request(app).post('/exchange').send(VALID_EXCHANGE_BODY);
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /refresh ─────────────────────────────────────────────────────────

  describe('POST /refresh', () => {
    it('returns 200 with new accessToken and rotates the rt cookie', async () => {
      (refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
      });

      const res = await request(app)
        .post('/refresh')
        .set('Cookie', 'rt=old-refresh-token');

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe('new-at');
      expect(getRtCookie(res)).toContain('new-rt');
    });

    it('calls refreshAccessToken with the cookie value', async () => {
      (refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        accessToken: 'at',
        refreshToken: 'rotated-rt',
      });

      await request(app)
        .post('/refresh')
        .set('Cookie', 'rt=my-refresh-token');

      expect(refreshAccessToken).toHaveBeenCalledWith('my-refresh-token');
    });

    it('returns 401 with error message when rt cookie is absent', async () => {
      const res = await request(app).post('/refresh');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No refresh token');
    });

    it('does not call refreshAccessToken when rt cookie is absent', async () => {
      await request(app).post('/refresh');
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it('returns 400 when Keycloak rejects the refresh token', async () => {
      (refreshAccessToken as jest.Mock).mockRejectedValueOnce(
        new Error('Token expired or revoked')
      );

      const res = await request(app)
        .post('/refresh')
        .set('Cookie', 'rt=expired-token');

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /logout ──────────────────────────────────────────────────────────

  describe('POST /logout', () => {
    it('returns 200 with logout message', async () => {
      (revokeToken as jest.Mock).mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post('/logout')
        .set('Cookie', 'rt=some-rt');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out');
    });

    it('clears the rt cookie (Set-Cookie with empty value)', async () => {
      (revokeToken as jest.Mock).mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post('/logout')
        .set('Cookie', 'rt=some-rt');

      const rt = getRtCookie(res);
      expect(rt).toBeDefined();
      // Cookie value should be empty — starts with "rt=;" (no value before the semicolon)
      expect(rt).toMatch(/^rt=;/);
    });

    it('calls revokeToken with the rt cookie value', async () => {
      (revokeToken as jest.Mock).mockResolvedValueOnce(undefined);

      await request(app)
        .post('/logout')
        .set('Cookie', 'rt=my-refresh-token');

      expect(revokeToken).toHaveBeenCalledWith('my-refresh-token');
    });

    it('returns 200 even when revokeToken throws (best-effort revocation)', async () => {
      (revokeToken as jest.Mock).mockRejectedValueOnce(new Error('Keycloak unreachable'));

      const res = await request(app)
        .post('/logout')
        .set('Cookie', 'rt=some-rt');

      expect(res.status).toBe(200);
    });

    it('still clears the cookie when revokeToken throws', async () => {
      (revokeToken as jest.Mock).mockRejectedValueOnce(new Error('Keycloak unreachable'));

      const res = await request(app)
        .post('/logout')
        .set('Cookie', 'rt=some-rt');

      expect(getRtCookie(res)).toMatch(/^rt=;/);
    });

    it('returns 200 even when no rt cookie is present (idempotent logout)', async () => {
      const res = await request(app).post('/logout');
      expect(res.status).toBe(200);
    });

    it('does not call revokeToken when no rt cookie is present', async () => {
      await request(app).post('/logout');
      expect(revokeToken).not.toHaveBeenCalled();
    });
  });
});
