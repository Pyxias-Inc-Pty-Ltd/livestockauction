import { Types } from 'mongoose';
import { IBidder, ISeller, IUser } from '../../../src/models/user-model';
import {
  EUserType,
  EIdentityNumberVerificationStatus,
  ESectorType,
} from '../../../src/globals';

let emailSeq = 0;
function uniqueEmail(prefix: string) {
  return `${prefix}_${++emailSeq}_${Date.now()}@test.com`;
}

let identitySeq = 0;

export function buildBidder(overrides: Partial<IBidder> = {}): Partial<IBidder> {
  return {
    _id: new Types.ObjectId(),
    userType: EUserType.BIDDER,
    firstName: 'Test',
    lastName: 'Bidder',
    email: uniqueEmail('bidder'),
    phone: '+26771234567',
    keycloakId: new Types.ObjectId().toHexString(),
    identityNumber: `ID${++identitySeq}${Date.now()}`,
    nationality: 'BW',
    dob: new Date('1990-01-01'),
    gender: 'MALE',
    isOrganization: false,
    tz: 'Africa/Gaborone',
    locale: 'en',
    firebaseTokenId: 'test-firebase-token',
    physicalAddress: '1 Test Street, Gaborone',
    postalAddress: 'P.O. Box 1, Gaborone',
    isKeeperIdVerified: false,
    identityNumberVerificationRetryCount: 0,
    identityNumberVerificationStatus: EIdentityNumberVerificationStatus.PENDING,
    keeperIdHash: '',
    ...overrides,
  } as Partial<IBidder>;
}

export function buildSeller(overrides: Partial<ISeller> = {}): Partial<ISeller> {
  return {
    _id: new Types.ObjectId(),
    userType: EUserType.SELLER,
    name: 'Test Seller Ltd',
    email: uniqueEmail('seller'),
    phone: '+26772345678',
    keycloakId: new Types.ObjectId().toHexString(),
    sectorType: ESectorType.GOVERNMENT,
    tz: 'Africa/Gaborone',
    locale: 'en',
    firebaseTokenId: 'test-firebase-token',
    ...overrides,
  } as Partial<ISeller>;
}

export function buildAdmin(overrides: Partial<IUser> = {}): Partial<IUser> {
  return {
    _id: new Types.ObjectId(),
    userType: EUserType.ADMIN,
    firstName: 'Super',
    lastName: 'Admin',
    email: uniqueEmail('admin'),
    phone: '+26773456789',
    keycloakId: new Types.ObjectId().toHexString(),
    tz: 'Africa/Gaborone',
    locale: 'en',
    firebaseTokenId: 'test-firebase-token',
    ...overrides,
  };
}
