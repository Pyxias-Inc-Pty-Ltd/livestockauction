/**
 * Unit tests for src/shared/middleware.ts
 *
 * Covers: requirePermission, requireAnyPermission, requireRole, requireAnyRole,
 *         and role-alias helpers (SuperAdminOnly, SellerOnly, BidderOnly, AuctionApproverOnly).
 *
 * No DB required — all tested functions are synchronous middleware factories that
 * only inspect req.permissions / req.roles.
 */

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

// Prevent top-level imports in middleware.ts from pulling in real infrastructure.
jest.mock('jose', () => ({ jwtVerify: jest.fn(), createRemoteJWKSet: jest.fn() }));

jest.mock('../../../src/shared/keycloak', () => ({
  JWKS: {},
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/auctions',
}));

jest.mock('../../../src/services/user-service', () => ({
  __esModule: true,
  default: { getByKeycloakId: jest.fn() },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireAnyRole,
  SuperAdminOnly,
  SellerOnly,
  BidderOnly,
  AuctionApproverOnly,
} from '../../../src/shared/middleware';
import { UnauthorizedError } from '../../../src/shared/errors';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a mock Express triple (req, res, next) with given permissions/roles. */
function makeMocks(permissions: string[] = [], roles: string[] = []) {
  const req = { permissions, roles } as any;
  const res = {} as any;
  const next = jest.fn() as jest.Mock;
  return { req, res, next };
}

/** Assert next was called with no arguments (i.e. success). */
function expectNextOk(next: jest.Mock) {
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0]).toHaveLength(0);
}

/** Assert next was called with an UnauthorizedError. */
function expectNextError(next: jest.Mock) {
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── requirePermission ──────────────────────────────────────────────────────

  describe('requirePermission', () => {
    it('calls next() when the required permission is present', () => {
      const { req, res, next } = makeMocks(['auction:read']);
      requirePermission('auction:read')(req, res, next);
      expectNextOk(next);
    });

    it('calls next(UnauthorizedError) when the permission is missing', () => {
      const { req, res, next } = makeMocks([]);
      requirePermission('auction:read')(req, res, next);
      expectNextError(next);
    });

    it('requires ALL listed permissions — one missing → error', () => {
      const { req, res, next } = makeMocks(['auction:read']);
      requirePermission('auction:read', 'auction:manage')(req, res, next);
      expectNextError(next);
    });

    it('calls next() when ALL listed permissions are present', () => {
      const { req, res, next } = makeMocks(['auction:read', 'auction:manage']);
      requirePermission('auction:read', 'auction:manage')(req, res, next);
      expectNextOk(next);
    });

    it('includes the missing permission name in the error message', () => {
      const { req, res, next } = makeMocks([]);
      requirePermission('form:manage')(req, res, next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toContain('form:manage');
    });

    it('handles empty permissions array on req', () => {
      const { req, res, next } = makeMocks([]);
      requirePermission('any:permission')(req, res, next);
      expectNextError(next);
    });
  });

  // ─── requireAnyPermission ────────────────────────────────────────────────

  describe('requireAnyPermission', () => {
    it('calls next() when at least one listed permission is present', () => {
      const { req, res, next } = makeMocks(['form:read']);
      requireAnyPermission('form:read', 'form:manage')(req, res, next);
      expectNextOk(next);
    });

    it('calls next(UnauthorizedError) when none of the listed permissions match', () => {
      const { req, res, next } = makeMocks(['other:permission']);
      requireAnyPermission('form:read', 'form:manage')(req, res, next);
      expectNextError(next);
    });

    it('calls next() when all listed permissions are present', () => {
      const { req, res, next } = makeMocks(['form:read', 'form:manage']);
      requireAnyPermission('form:read', 'form:manage')(req, res, next);
      expectNextOk(next);
    });

    it('calls next(UnauthorizedError) when req has no permissions at all', () => {
      const { req, res, next } = makeMocks([]);
      requireAnyPermission('form:read')(req, res, next);
      expectNextError(next);
    });
  });

  // ─── requireRole ─────────────────────────────────────────────────────────

  describe('requireRole', () => {
    it('calls next() when the required role is present', () => {
      const { req, res, next } = makeMocks([], ['SELLER']);
      requireRole('SELLER')(req, res, next);
      expectNextOk(next);
    });

    it('calls next(UnauthorizedError) when the role is absent', () => {
      const { req, res, next } = makeMocks([], ['BIDDER']);
      requireRole('SELLER')(req, res, next);
      expectNextError(next);
    });

    it('calls next(UnauthorizedError) when req has no roles', () => {
      const { req, res, next } = makeMocks([], []);
      requireRole('SELLER')(req, res, next);
      expectNextError(next);
    });

    it('uses the custom error message when provided', () => {
      const { req, res, next } = makeMocks([], []);
      requireRole('SELLER', 'Custom seller error')(req, res, next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toBe('Custom seller error');
    });

    it('uses a default error message when no custom message given', () => {
      const { req, res, next } = makeMocks([], []);
      requireRole('SELLER')(req, res, next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toContain('SELLER');
    });
  });

  // ─── requireAnyRole ──────────────────────────────────────────────────────

  describe('requireAnyRole', () => {
    it('calls next() when at least one listed role is present', () => {
      const { req, res, next } = makeMocks([], ['SELLER']);
      requireAnyRole(['SUPER', 'SELLER'])(req, res, next);
      expectNextOk(next);
    });

    it('calls next(UnauthorizedError) when none of the listed roles match', () => {
      const { req, res, next } = makeMocks([], ['BIDDER']);
      requireAnyRole(['SUPER', 'SELLER'])(req, res, next);
      expectNextError(next);
    });

    it('calls next() when all listed roles are present', () => {
      const { req, res, next } = makeMocks([], ['SUPER', 'SELLER']);
      requireAnyRole(['SUPER', 'SELLER'])(req, res, next);
      expectNextOk(next);
    });

    it('uses the custom error message when provided', () => {
      const { req, res, next } = makeMocks([], []);
      requireAnyRole(['SUPER'], 'Need SUPER role')(req, res, next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toBe('Need SUPER role');
    });
  });

  // ─── Role-alias helpers ───────────────────────────────────────────────────

  describe('SuperAdminOnly', () => {
    it('calls next() for the SUPER role', () => {
      const { req, res, next } = makeMocks([], ['SUPER']);
      SuperAdminOnly()(req, res, next);
      expectNextOk(next);
    });

    it('blocks requests that lack the SUPER role', () => {
      const { req, res, next } = makeMocks([], ['ADMIN']);
      SuperAdminOnly()(req, res, next);
      expectNextError(next);
    });

    it('accepts a custom error message', () => {
      const { req, res, next } = makeMocks([], []);
      SuperAdminOnly('Super admin only')(req, res, next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toBe('Super admin only');
    });
  });

  describe('SellerOnly', () => {
    it('calls next() for the SELLER role', () => {
      const { req, res, next } = makeMocks([], ['SELLER']);
      SellerOnly()(req, res, next);
      expectNextOk(next);
    });

    it('blocks a BIDDER role', () => {
      const { req, res, next } = makeMocks([], ['BIDDER']);
      SellerOnly()(req, res, next);
      expectNextError(next);
    });
  });

  describe('BidderOnly', () => {
    it('calls next() for the BIDDER role', () => {
      const { req, res, next } = makeMocks([], ['BIDDER']);
      BidderOnly()(req, res, next);
      expectNextOk(next);
    });

    it('blocks a SELLER role', () => {
      const { req, res, next } = makeMocks([], ['SELLER']);
      BidderOnly()(req, res, next);
      expectNextError(next);
    });
  });

  describe('AuctionApproverOnly', () => {
    it('calls next() for the AUCTION_APPROVER role', () => {
      const { req, res, next } = makeMocks([], ['AUCTION_APPROVER']);
      AuctionApproverOnly()(req, res, next);
      expectNextOk(next);
    });

    it('blocks SELLER role', () => {
      const { req, res, next } = makeMocks([], ['SELLER']);
      AuctionApproverOnly()(req, res, next);
      expectNextError(next);
    });
  });
});
