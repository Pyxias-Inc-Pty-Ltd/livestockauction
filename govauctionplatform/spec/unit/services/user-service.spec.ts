/**
 * user-service unit/integration tests.
 *
 * Uses MongoMemoryServer (single node — user-service has no Mongoose transactions).
 *
 * Mocks:
 *   - axios                  — silences model post-save queue/HTTP side-effects
 *   - src/shared/keycloak    — createKeycloakUser, assignRealmRole, sendWelcomeEmail,
 *                              deleteKeycloakUser, resetKeycloakUserPassword
 */

// ─── Module mocks (hoisted by Jest before imports) ───────────────────────────

jest.mock('axios', () => {
  const mockMethods = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  return { __esModule: true, ...mockMethods, default: mockMethods };
});

jest.mock('../../../src/shared/keycloak', () => ({
  createKeycloakUser: jest.fn().mockResolvedValue('kc-id-from-mock'),
  assignRealmRole: jest.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  deleteKeycloakUser: jest.fn().mockResolvedValue(undefined),
  resetKeycloakUserPassword: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { Types } from 'mongoose';
import {
  User,
  Bidder,
  Seller,
  Admin,
  AuctionApprover,
  IBidder,
  ISeller,
  IAuctionApprover,
  IBidderInput,
  ISellerInput,
  IAdminInput,
  IAuctionApproverInput,
} from '../../../src/models/user-model';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { EUserType } from '../../../src/globals';
import {
  createKeycloakUser,
  assignRealmRole,
  sendWelcomeEmail,
  deleteKeycloakUser,
  resetKeycloakUserPassword,
} from '../../../src/shared/keycloak';
import userService from '../../../src/services/user-service';
import { connectTestDb, disconnectTestDb, clearTestDb } from '../../helpers/db';
import { buildBidder, buildSeller, buildAdmin } from '../../helpers/factories/user.factory';

// ─── Seed helpers ─────────────────────────────────────────────────────────────

let identitySeq = 0;
function uniqueIdentityNumber() {
  return `TEST${++identitySeq}${Date.now()}`;
}

async function seedBidder(overrides: Partial<Record<string, any>> = {}): Promise<IBidder> {
  const data = {
    ...buildBidder(),
    __t: 'Bidder',
    identityNumber: uniqueIdentityNumber(),
    ...overrides,
  };
  await Bidder.collection.insertOne(data as any);
  return (await Bidder.findById(data._id))!;
}

async function seedSeller(overrides: Partial<Record<string, any>> = {}): Promise<ISeller> {
  const data = { ...buildSeller(), __t: 'Seller', ...overrides };
  await Seller.collection.insertOne(data as any);
  return (await Seller.findById(data._id))!;
}

async function seedAdmin(overrides: Partial<Record<string, any>> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    __t: 'Admin',
    userType: EUserType.ADMIN,
    email: `admin_${Date.now()}@test.com`,
    firstName: 'Test',
    lastName: 'Admin',
    keycloakId: new Types.ObjectId().toHexString(),
    tz: 'Africa/Gaborone',
    locale: 'en',
    ...overrides,
  };
  await Admin.collection.insertOne(data as any);
  return (await Admin.findById(data._id))!;
}

async function seedAuctionApprover(
  sellerId: Types.ObjectId,
  overrides: Partial<Record<string, any>> = {}
): Promise<IAuctionApprover> {
  const data = {
    _id: new Types.ObjectId(),
    __t: 'AuctionApprover',
    userType: EUserType.AUCTION_APPROVER,
    email: `approver_${Date.now()}_${Math.random()}@test.com`,
    firstName: 'Test',
    lastName: 'Approver',
    keycloakId: new Types.ObjectId().toHexString(),
    createdBySeller: sellerId,
    isActive: true,
    tz: 'Africa/Gaborone',
    locale: 'en',
    ...overrides,
  };
  await AuctionApprover.collection.insertOne(data as any);
  return (await AuctionApprover.findById(data._id))!;
}

/** Minimal valid IBidderInput for createBidder tests. */
function makeBidderInput(overrides: Partial<IBidderInput> = {}): IBidderInput {
  return {
    isOrganization: false,
    identityNumber: uniqueIdentityNumber(),
    nationality: 'BW',
    dob: new Date('1990-01-01'),
    gender: 'MALE',
    physicalAddress: '1 Test St, Gaborone',
    postalAddress: 'P.O. Box 1, Gaborone',
    email: `bidder_${Date.now()}@test.com`,
    phone: '+26771234567',
    password: 'password123',
    firstName: 'Test',
    lastName: 'Bidder',
    locale: 'en',
    tz: 'Africa/Gaborone',
    ...overrides,
  };
}

/** Minimal valid IAdminInput. */
function makeAdminInput(overrides: Partial<IAdminInput> = {}): IAdminInput {
  return {
    adminType: 'SUPER',
    email: `admin_${Date.now()}@test.com`,
    phone: '+26771234567',
    password: 'adminpass',
    firstName: 'Root',
    lastName: 'Admin',
    locale: 'en',
    tz: 'Africa/Gaborone',
    ...overrides,
  };
}

/** Minimal valid ISellerInput. */
function makeSellerInput(overrides: Partial<ISellerInput> = {}): ISellerInput {
  return {
    email: `seller_${Date.now()}@test.com`,
    phone: '+26772345678',
    password: 'sellerpass',
    name: 'Test Seller Ltd',
    locale: 'en',
    tz: 'Africa/Gaborone',
    ...overrides,
  };
}

/** Minimal valid IAuctionApproverInput. */
function makeApproverInput(
  sellerId: string,
  overrides: Partial<IAuctionApproverInput> = {}
): IAuctionApproverInput {
  return {
    createdBySeller: sellerId,
    password: 'approverpass',
    email: `approver_${Date.now()}@test.com`,
    firstName: 'Test',
    lastName: 'Approver',
    locale: 'en',
    tz: 'Africa/Gaborone',
    ...overrides,
  };
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  await clearTestDb();
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('user-service', () => {
  // ─── getById ─────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns null for a valid ObjectId that does not exist', async () => {
      const result = await userService.getById(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });

    it('returns the user document for a valid id', async () => {
      const bidder = await seedBidder();
      const result = await userService.getById(bidder.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(bidder.id);
    });
  });

  // ─── getByEmail ───────────────────────────────────────────────────────────

  describe('getByEmail', () => {
    it('returns null when no user has that email', async () => {
      const result = await userService.getByEmail('ghost@test.com');
      expect(result).toBeNull();
    });

    it('returns the user when found by email', async () => {
      const bidder = await seedBidder({ email: 'target@test.com' });
      const result = await userService.getByEmail('target@test.com');
      expect(result!.id).toBe(bidder.id);
    });
  });

  // ─── getByPhone ───────────────────────────────────────────────────────────

  describe('getByPhone', () => {
    it('returns null when no user has that phone', async () => {
      const result = await userService.getByPhone('+26799999999');
      expect(result).toBeNull();
    });

    it('returns the user when found by phone', async () => {
      const bidder = await seedBidder({ phone: '+26799000001' });
      const result = await userService.getByPhone('+26799000001');
      expect(result!.id).toBe(bidder.id);
    });
  });

  // ─── getByKeycloakId ──────────────────────────────────────────────────────

  describe('getByKeycloakId', () => {
    it('returns null when no user has that keycloakId', async () => {
      const result = await userService.getByKeycloakId('non-existent-kc-id');
      expect(result).toBeNull();
    });

    it('returns the user when found by keycloakId', async () => {
      const kcId = 'kc-id-known';
      const bidder = await seedBidder({ keycloakId: kcId });
      const result = await userService.getByKeycloakId(kcId);
      expect(result!.id).toBe(bidder.id);
    });
  });

  // ─── createInitAdmin ─────────────────────────────────────────────────────

  describe('createInitAdmin', () => {
    it('throws ConflictError when a SUPER admin already exists', async () => {
      // Seed directly via collection.insertOne so adminType is stored (bypasses strict schema)
      // Must include __t so the Admin discriminator query (which filters by __t) finds it
      await Admin.collection.insertOne({
        _id: new Types.ObjectId(),
        __t: 'Admin',
        userType: EUserType.ADMIN,
        adminType: 'SUPER',
        email: 'root@test.com',
        firstName: 'Root',
        lastName: 'Admin',
        keycloakId: 'existing-kc',
        tz: 'Africa/Gaborone',
        locale: 'en',
        createdDate: new Date(),
        updatedDate: new Date(),
      } as any);

      await expect(userService.createInitAdmin(makeAdminInput())).rejects.toThrow(ConflictError);
    });

    it('creates an admin in Keycloak and assigns the ADMIN realm role', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('new-admin-kc-id');

      await userService.createInitAdmin(makeAdminInput());

      expect(createKeycloakUser).toHaveBeenCalledTimes(1);
      expect(assignRealmRole).toHaveBeenCalledWith('new-admin-kc-id', 'ADMIN');
    });

    it('persists the admin in MongoDB with the returned keycloakId', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('admin-kc-xyz');

      const admin = await userService.createInitAdmin(makeAdminInput({ email: 'stored@test.com' }));

      expect(admin.keycloakId).toBe('admin-kc-xyz');
      const stored = await Admin.findById(admin._id);
      expect(stored).not.toBeNull();
    });

    it('does not store the password in MongoDB', async () => {
      const result = await userService.createInitAdmin(makeAdminInput());
      const stored = await Admin.findById(result._id);
      expect(stored!.password).toBeUndefined();
    });
  });

  // ─── createBidder ─────────────────────────────────────────────────────────

  describe('createBidder', () => {
    it('creates a bidder in Keycloak with email as username', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('bidder-kc-id');
      const input = makeBidderInput({ email: 'bidder@example.com' });

      await userService.createBidder(input);

      expect(createKeycloakUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'bidder@example.com', email: 'bidder@example.com' })
      );
    });

    it('assigns the BIDDER realm role in Keycloak', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('bidder-kc-id');

      await userService.createBidder(makeBidderInput());

      expect(assignRealmRole).toHaveBeenCalledWith('bidder-kc-id', 'BIDDER');
    });

    it('persists the bidder in MongoDB without a password', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('bidder-kc-saved');
      const input = makeBidderInput({ email: 'saved@test.com' });

      const result = await userService.createBidder(input);

      const stored = await Bidder.findById(result._id);
      expect(stored).not.toBeNull();
      expect(stored!.password).toBeUndefined();
      expect(stored!.keycloakId).toBe('bidder-kc-saved');
    });
  });

  // ─── createSeller ─────────────────────────────────────────────────────────

  describe('createSeller', () => {
    const mockAdmin = { tz: 'Africa/Gaborone', locale: 'en' } as any;

    it('creates a seller in Keycloak without a password (welcome email flow)', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('seller-kc-id');

      await userService.createSeller(mockAdmin, makeSellerInput({ email: 'seller@example.com' }));

      expect(createKeycloakUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'seller@example.com' })
      );
      // No password field in the Keycloak call
      expect(createKeycloakUser).toHaveBeenCalledWith(
        expect.not.objectContaining({ password: expect.anything() })
      );
    });

    it('assigns the SELLER realm role in Keycloak', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('seller-kc-id');

      await userService.createSeller(mockAdmin, makeSellerInput());

      expect(assignRealmRole).toHaveBeenCalledWith('seller-kc-id', 'SELLER');
    });

    it('sends a welcome email to the seller', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('seller-kc-id');

      await userService.createSeller(mockAdmin, makeSellerInput());

      expect(sendWelcomeEmail).toHaveBeenCalledWith('seller-kc-id');
    });

    it('persists the seller in MongoDB without a password', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('seller-kc-stored');
      const input = makeSellerInput({ email: 'sst@test.com' });

      const result = await userService.createSeller(mockAdmin, input);

      const stored = await Seller.findById(result._id);
      expect(stored).not.toBeNull();
      expect(stored!.password).toBeUndefined();
      expect(stored!.keycloakId).toBe('seller-kc-stored');
    });
  });

  // ─── createAuctionApprover ────────────────────────────────────────────────

  describe('createAuctionApprover', () => {
    const sellerId = new Types.ObjectId();
    const mockSeller = {
      id: sellerId.toString(),
      tz: 'Africa/Gaborone',
      locale: 'en',
    } as any;

    it('creates an approver in Keycloak and assigns AUCTION_APPROVER role', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('approver-kc-id');

      await userService.createAuctionApprover(
        mockSeller,
        makeApproverInput(sellerId.toString(), { email: 'approver@example.com' })
      );

      expect(createKeycloakUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'approver@example.com' })
      );
      expect(assignRealmRole).toHaveBeenCalledWith('approver-kc-id', 'AUCTION_APPROVER');
    });

    it('sends a welcome email to the approver', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('approver-kc-id');

      await userService.createAuctionApprover(mockSeller, makeApproverInput(sellerId.toString()));

      expect(sendWelcomeEmail).toHaveBeenCalledWith('approver-kc-id');
    });

    it('persists the approver in MongoDB linked to the creating seller', async () => {
      (createKeycloakUser as jest.Mock).mockResolvedValueOnce('approver-kc-stored');

      const result = await userService.createAuctionApprover(
        mockSeller,
        makeApproverInput(sellerId.toString())
      );

      const stored = await AuctionApprover.findById(result._id);
      expect(stored).not.toBeNull();
      expect(stored!.createdBySeller.toString()).toBe(sellerId.toString());
      expect(stored!.password).toBeUndefined();
    });
  });

  // ─── getUsers ─────────────────────────────────────────────────────────────

  describe('getUsers', () => {
    it('throws ForbiddenError when limit exceeds MAX_LIST_LIMIT_NUMBER (100)', async () => {
      await expect(
        userService.getUsers(new Map([['limit', 101]]))
      ).rejects.toThrow(ForbiddenError);
    });

    it('returns all users when no filters applied', async () => {
      await seedBidder();
      await seedSeller();

      const results = await userService.getUsers(new Map());
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by userType', async () => {
      await seedBidder();
      await seedSeller();

      const results = await userService.getUsers(new Map([['userType', EUserType.SELLER]]));
      expect(results.every((u) => u.userType === EUserType.SELLER)).toBe(true);
    });

    it('respects a custom limit', async () => {
      await seedBidder();
      await seedBidder();
      await seedBidder();

      const results = await userService.getUsers(new Map([['limit', 2]]));
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ─── getAdmins ────────────────────────────────────────────────────────────

  describe('getAdmins', () => {
    it('returns only ADMIN users', async () => {
      await seedAdmin();
      await seedBidder();

      const results = await userService.getAdmins();
      expect(results.every((u) => u.userType === EUserType.ADMIN)).toBe(true);
    });

    it('returns an empty array when no admins exist', async () => {
      await seedBidder();
      const results = await userService.getAdmins();
      expect(results).toHaveLength(0);
    });
  });

  // ─── setFirebaseTokenId ───────────────────────────────────────────────────

  describe('setFirebaseTokenId', () => {
    it('updates firebaseTokenId on the user document', async () => {
      const bidder = await seedBidder();

      await userService.setFirebaseTokenId(bidder, 'new-firebase-token-abc');

      const updated = await Bidder.findById(bidder._id);
      expect(updated!.firebaseTokenId).toBe('new-firebase-token-abc');
    });
  });

  // ─── getUserReport ────────────────────────────────────────────────────────

  describe('getUserReport', () => {
    it('returns correct totalUsers count', async () => {
      await seedBidder();
      await seedSeller();

      const report = await userService.getUserReport();
      expect(report.totalUsers).toBeGreaterThanOrEqual(2);
    });

    it('groups users by type in usersByType', async () => {
      await seedBidder();
      await seedSeller();

      const report = await userService.getUserReport();
      const bidderGroup = report.usersByType.find((g: any) => g._id === EUserType.BIDDER);
      const sellerGroup = report.usersByType.find((g: any) => g._id === EUserType.SELLER);
      expect(bidderGroup).toBeDefined();
      expect(sellerGroup).toBeDefined();
    });
  });

  // ─── getAuctionApproversForSeller ─────────────────────────────────────────

  describe('getAuctionApproversForSeller', () => {
    it('returns only active approvers created by the given seller', async () => {
      const sellerId = new Types.ObjectId();
      const otherSellerId = new Types.ObjectId();

      await seedAuctionApprover(sellerId);
      await seedAuctionApprover(otherSellerId); // different seller → should not appear

      const results = await userService.getAuctionApproversForSeller(sellerId.toString());
      expect(results).toHaveLength(1);
      expect(results[0].createdBySeller.toString()).toBe(sellerId.toString());
    });

    it('excludes inactive approvers', async () => {
      const sellerId = new Types.ObjectId();
      await seedAuctionApprover(sellerId, { isActive: false });

      const results = await userService.getAuctionApproversForSeller(sellerId.toString());
      expect(results).toHaveLength(0);
    });
  });

  // ─── getAuctionApproverById ───────────────────────────────────────────────

  describe('getAuctionApproverById', () => {
    it('returns null for an unknown id', async () => {
      const result = await userService.getAuctionApproverById(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });

    it('returns the approver document for a valid id', async () => {
      const sellerId = new Types.ObjectId();
      const approver = await seedAuctionApprover(sellerId);
      const result = await userService.getAuctionApproverById(approver._id);
      expect(result!.id).toBe(approver.id);
    });
  });

  // ─── updateAuctionApproverStatus ─────────────────────────────────────────

  describe('updateAuctionApproverStatus', () => {
    it('throws ConflictError when approver does not belong to the seller', async () => {
      const sellerId = new Types.ObjectId();
      const otherSellerId = new Types.ObjectId();
      const approver = await seedAuctionApprover(otherSellerId);

      const mockSeller = { id: sellerId.toString() } as any;
      await expect(
        userService.updateAuctionApproverStatus(mockSeller, approver._id, false)
      ).rejects.toThrow(ConflictError);
    });

    it('sets isActive = false when deactivating', async () => {
      const sellerId = new Types.ObjectId();
      const approver = await seedAuctionApprover(sellerId, { isActive: true });
      const mockSeller = { id: sellerId.toString() } as any;

      await userService.updateAuctionApproverStatus(mockSeller, approver._id, false);

      const updated = await AuctionApprover.findById(approver._id);
      expect(updated!.isActive).toBe(false);
    });

    it('sets isActive = true when reactivating', async () => {
      const sellerId = new Types.ObjectId();
      const approver = await seedAuctionApprover(sellerId, { isActive: false });
      const mockSeller = { id: sellerId.toString() } as any;

      await userService.updateAuctionApproverStatus(mockSeller, approver._id, true);

      const updated = await AuctionApprover.findById(approver._id);
      expect(updated!.isActive).toBe(true);
    });
  });

  // ─── updatePasswordInKeycloak ─────────────────────────────────────────────

  describe('updatePasswordInKeycloak', () => {
    it('delegates to resetKeycloakUserPassword with the correct arguments', async () => {
      await userService.updatePasswordInKeycloak('kc-user-abc', 'newpass123');
      expect(resetKeycloakUserPassword).toHaveBeenCalledWith('kc-user-abc', 'newpass123', false);
    });
  });

  // ─── deleteUser ───────────────────────────────────────────────────────────

  describe('deleteUser', () => {
    it('throws NotFoundError when user does not exist', async () => {
      await expect(
        userService.deleteUser(new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('calls deleteKeycloakUser when the user has a keycloakId', async () => {
      const bidder = await seedBidder({ keycloakId: 'kc-to-delete' });

      await userService.deleteUser(bidder.id);

      expect(deleteKeycloakUser).toHaveBeenCalledWith('kc-to-delete');
    });

    it('removes the user from MongoDB', async () => {
      const bidder = await seedBidder();

      await userService.deleteUser(bidder.id);

      const found = await User.findById(bidder._id);
      expect(found).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // addStrike / removeBlacklist / isBlacklisted — hybrid floor bidding
  // ───────────────────────────────────────────────────────────────────────────

  describe('addStrike', () => {
    const auctionId = new Types.ObjectId().toString();
    const itemId = new Types.ObjectId().toString();

    it('adds a strike to a user with zero existing strikes', async () => {
      const bidder = await seedBidder({ strikes: [], blacklisted: false });

      const updated = await userService.addStrike(bidder.id, auctionId, itemId, 'NON_PAYMENT');

      expect(updated!.strikes).toHaveLength(1);
      expect(updated!.strikes[0].auctionId).toBe(auctionId);
      expect(updated!.strikes[0].itemId).toBe(itemId);
      expect(updated!.strikes[0].reason).toBe('NON_PAYMENT');
      expect(updated!.blacklisted).toBe(false);
    });

    it('adds a second strike without blacklisting', async () => {
      const bidder = await seedBidder({
        strikes: [{ auctionId: 'a1', itemId: 'i1', reason: 'NON_PAYMENT', createdAt: new Date() }],
        blacklisted: false,
      });

      const updated = await userService.addStrike(bidder.id, auctionId, itemId, 'NON_PAYMENT');

      expect(updated!.strikes).toHaveLength(2);
      expect(updated!.blacklisted).toBe(false);
    });

    it('auto-blacklists when the third strike is added', async () => {
      const bidder = await seedBidder({
        strikes: [
          { auctionId: 'a1', itemId: 'i1', reason: 'NON_PAYMENT', createdAt: new Date() },
          { auctionId: 'a2', itemId: 'i2', reason: 'NON_PAYMENT', createdAt: new Date() },
        ],
        blacklisted: false,
      });

      const updated = await userService.addStrike(bidder.id, auctionId, itemId, 'NON_PAYMENT');

      expect(updated!.strikes).toHaveLength(3);
      expect(updated!.blacklisted).toBe(true);
    });

    it('does not re-save blacklisted when already blacklisted', async () => {
      const bidder = await seedBidder({
        strikes: [
          { auctionId: 'a1', itemId: 'i1', reason: 'NON_PAYMENT', createdAt: new Date() },
          { auctionId: 'a2', itemId: 'i2', reason: 'NON_PAYMENT', createdAt: new Date() },
          { auctionId: 'a3', itemId: 'i3', reason: 'NON_PAYMENT', createdAt: new Date() },
        ],
        blacklisted: true,
      });

      const updated = await userService.addStrike(bidder.id, auctionId, itemId, 'NON_PAYMENT');

      expect(updated!.strikes).toHaveLength(4);
      expect(updated!.blacklisted).toBe(true); // still blacklisted
    });

    it('throws NotFoundError when user does not exist', async () => {
      await expect(
        userService.addStrike(new Types.ObjectId().toString(), auctionId, itemId, 'NON_PAYMENT'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('removeBlacklist', () => {
    it('sets blacklisted to false for a blacklisted user', async () => {
      const bidder = await seedBidder({ blacklisted: true });

      const updated = await userService.removeBlacklist(bidder.id);

      expect(updated!.blacklisted).toBe(false);
    });

    it('is a no-op for an already non-blacklisted user', async () => {
      const bidder = await seedBidder({ blacklisted: false });

      const updated = await userService.removeBlacklist(bidder.id);

      expect(updated!.blacklisted).toBe(false);
    });

    it('returns null for a nonexistent user', async () => {
      const result = await userService.removeBlacklist(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });
  });

  describe('isBlacklisted', () => {
    it('returns true when user is blacklisted', async () => {
      const bidder = await seedBidder({ blacklisted: true });

      const result = await userService.isBlacklisted(bidder.id);

      expect(result).toBe(true);
    });

    it('returns false when user is not blacklisted', async () => {
      const bidder = await seedBidder({ blacklisted: false });

      const result = await userService.isBlacklisted(bidder.id);

      expect(result).toBe(false);
    });

    it('returns false when user does not exist', async () => {
      const result = await userService.isBlacklisted(new Types.ObjectId().toString());
      expect(result).toBe(false);
    });
  });
});
