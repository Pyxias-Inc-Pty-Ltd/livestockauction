jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import * as axios from 'axios';
import {
  sortNumberListAsc,
  formatTimeGoogleCalendar,
  generateSlug,
  isBeforeStartDate,
  isBeforeEndDate,
  isStartDateBeforeEndDate,
  generateRandomPassword,
  convertToPaygateFormat,
  generatePayGatePaymentURL,
  prefixWithZero,
  formatBAITSAnimalEID,
  generateOTP,
  hashOTP,
  verifyOTP,
  generateAuctionNumber,
  formatPhoneNumber,
  normalizeAndCompareNames,
  getAnimalByEID,
  getAnimalByModisarId,
  getAnimalBreedById,
  getKeeperByRegNumber,
  getFarmerByKeeperId,
  transferAnimalBetweenKeepers,
  emailValidation,
  urlValidation,
  mongoIdValidation,
  isoDateValidation,
  isStringBooleanLike,
} from '../../../src/shared/functions';
import { NotFoundError, InternalServerError } from '../../../src/shared/errors';

const axiosGet = axios.default.get as jest.Mock;
const axiosPost = axios.default.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// sortNumberListAsc
// ─────────────────────────────────────────────────────────────────────────────
describe('sortNumberListAsc', () => {
  it('sorts unsorted array in ascending order', () => {
    expect(sortNumberListAsc([3, 1, 2])).toEqual([1, 2, 3]);
  });

  it('handles already-sorted array', () => {
    expect(sortNumberListAsc([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('handles single element', () => {
    expect(sortNumberListAsc([5])).toEqual([5]);
  });

  it('handles duplicates', () => {
    expect(sortNumberListAsc([2, 2, 1])).toEqual([1, 2, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatTimeGoogleCalendar
// ─────────────────────────────────────────────────────────────────────────────
describe('formatTimeGoogleCalendar', () => {
  it('returns date in YYYYMMDDTHHmmSSZ format (no dashes/colons/ms)', () => {
    const date = new Date('2024-01-15T10:30:45.000Z');
    expect(formatTimeGoogleCalendar(date)).toBe('20240115T103045Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateSlug
// ─────────────────────────────────────────────────────────────────────────────
describe('generateSlug', () => {
  it('converts spaces to underscores', () => {
    expect(generateSlug('Hello World')).toBe('hello_world');
  });

  it('lowercases the string', () => {
    expect(generateSlug('AUCTION ITEM')).toBe('auction_item');
  });

  it('strips non-alphanumeric characters', () => {
    expect(generateSlug('Hello! World?')).toBe('hello_world');
  });

  it('throws for non-string input', () => {
    expect(() => generateSlug(123 as any)).toThrow('Argument supplied must be a string');
  });

  it('throws for string with no alphanumeric characters', () => {
    expect(() => generateSlug('!!!')).toThrow('String must contain alpha-numeric characters');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Date comparison helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('date comparison functions', () => {
  const now    = new Date('2024-06-15T12:00:00Z');
  const past   = new Date('2024-06-14T12:00:00Z');
  const future = new Date('2024-06-16T12:00:00Z');

  describe('isBeforeStartDate', () => {
    it('returns true when now is before startDate', () => {
      expect(isBeforeStartDate(now, future)).toBe(true);
    });
    it('returns false when now is after startDate', () => {
      expect(isBeforeStartDate(now, past)).toBe(false);
    });
  });

  describe('isBeforeEndDate', () => {
    it('returns true when now is before endDate', () => {
      expect(isBeforeEndDate(now, future)).toBe(true);
    });
    it('returns false when now is after endDate', () => {
      expect(isBeforeEndDate(now, past)).toBe(false);
    });
  });

  describe('isStartDateBeforeEndDate', () => {
    it('returns true when startDate is before endDate', () => {
      expect(isStartDateBeforeEndDate(past, future)).toBe(true);
    });
    it('returns false when startDate is after endDate', () => {
      expect(isStartDateBeforeEndDate(future, past)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// prefixWithZero
// ─────────────────────────────────────────────────────────────────────────────
describe('prefixWithZero', () => {
  it('pads single-digit numbers with a leading zero', () => {
    expect(prefixWithZero(0)).toBe('00');
    expect(prefixWithZero(5)).toBe('05');
    expect(prefixWithZero(9)).toBe('09');
  });

  it('returns two-digit numbers as strings without padding', () => {
    expect(prefixWithZero(10)).toBe('10');
    expect(prefixWithZero(99)).toBe('99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateRandomPassword
// ─────────────────────────────────────────────────────────────────────────────
describe('generateRandomPassword', () => {
  it('returns a string of the default length (20)', () => {
    const pw = generateRandomPassword();
    expect(typeof pw).toBe('string');
    expect(pw.length).toBe(20);
  });

  it('returns a string of the requested custom length', () => {
    expect(generateRandomPassword(10).length).toBe(10);
    expect(generateRandomPassword(30).length).toBe(30);
  });

  it('only contains characters from the allowed set', () => {
    const pw = generateRandomPassword(60);
    expect(/^[A-Za-z0-9!@#$%^&*]+$/.test(pw)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatBAITSAnimalEID
// ─────────────────────────────────────────────────────────────────────────────
describe('formatBAITSAnimalEID', () => {
  it('inserts a space after the 4th character of a valid 16-char EID', () => {
    expect(formatBAITSAnimalEID('1234567890123456')).toBe('1234 567890123456');
  });

  it('throws for EID that is not 16 characters long', () => {
    expect(() => formatBAITSAnimalEID('12345')).toThrow('Invalid EID format');
    expect(() => formatBAITSAnimalEID('12345678901234567')).toThrow('Invalid EID format');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateOTP
// ─────────────────────────────────────────────────────────────────────────────
describe('generateOTP', () => {
  it('returns a 6-digit numeric string', () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('produces different values on successive calls', () => {
    const otps = new Set(Array.from({ length: 20 }, () => generateOTP()));
    expect(otps.size).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hashOTP + verifyOTP
// ─────────────────────────────────────────────────────────────────────────────
describe('hashOTP and verifyOTP', () => {
  it('verifies the correct OTP against its hash', async () => {
    const otp = '123456';
    const hashed = await hashOTP(otp);
    expect(typeof hashed).toBe('string');
    expect(hashed).not.toBe(otp);
    await expect(verifyOTP(otp, hashed)).resolves.toBe(true);
  });

  it('rejects an incorrect OTP against the hash', async () => {
    const hashed = await hashOTP('999999');
    await expect(verifyOTP('000000', hashed)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAuctionNumber
// ─────────────────────────────────────────────────────────────────────────────
describe('generateAuctionNumber', () => {
  it('returns an 11-character YYYYMMDDNNN string', () => {
    const number = generateAuctionNumber(0);
    expect(number).toMatch(/^\d{8}\d{3}$/);
    expect(number.endsWith('001')).toBe(true);
  });

  it('increments the count correctly', () => {
    expect(generateAuctionNumber(4).slice(-3)).toBe('005');
    expect(generateAuctionNumber(99).slice(-3)).toBe('100');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// convertToPaygateFormat
// ─────────────────────────────────────────────────────────────────────────────
describe('convertToPaygateFormat', () => {
  it('returns URL-encoded string with all required PayGate fields and an MD5 checksum', () => {
    const result = convertToPaygateFormat(
      'PG_ID', 'REF_001', 100, 'BWP',
      'https://example.com/return',
      new Date('2024-01-01T00:00:00.000Z'),
      'en', 'BWA', 'user@example.com',
      'https://example.com/notify',
      'secret_key',
    );
    const params = new URLSearchParams(result);
    expect(params.get('PAYGATE_ID')).toBe('PG_ID');
    expect(params.get('REFERENCE')).toBe('REF_001');
    expect(params.get('AMOUNT')).toBe('10000'); // 100 * 100
    expect(params.get('CURRENCY')).toBe('BWP');
    expect(params.get('EMAIL')).toBe('user@example.com');
    expect(params.get('CHECKSUM')).toMatch(/^[a-f0-9]{32}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generatePayGatePaymentURL
// ─────────────────────────────────────────────────────────────────────────────
describe('generatePayGatePaymentURL', () => {
  it('builds a valid process URL with PAY_REQUEST_ID and CHECKSUM params', () => {
    const baseString = 'PAYGATE_ID=100&PAY_REQUEST_ID=D7F69068-TEST-ID&REFERENCE=abc&CHECKSUM=abc123';
    const url = generatePayGatePaymentURL(baseString);
    expect(url).toContain('https://secure.paygate.co.za/payweb3/process.trans');
    expect(url).toContain('PAY_REQUEST_ID=');
    expect(url).toContain('CHECKSUM=');
  });

  it('throws when PAY_REQUEST_ID is missing', () => {
    expect(() => generatePayGatePaymentURL('CHECKSUM=abc123')).toThrow('Missing required parameters');
  });

  it('throws when CHECKSUM is missing', () => {
    expect(() => generatePayGatePaymentURL('PAY_REQUEST_ID=D7F69068-TEST')).toThrow('Missing required parameters');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeAndCompareNames
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeAndCompareNames', () => {
  it('matches identical names', () => {
    expect(normalizeAndCompareNames('John Doe', 'John Doe')).toBe(true);
  });

  it('matches names with different casing', () => {
    expect(normalizeAndCompareNames('JOHN DOE', 'john doe')).toBe(true);
  });

  it('matches hyphenated name against space-separated name', () => {
    expect(normalizeAndCompareNames('John-Doe', 'John Doe')).toBe(true);
  });

  it('returns false for names with different parts', () => {
    expect(normalizeAndCompareNames('Jane Doe', 'Jane D')).toBe(false);
  });

  it('returns false for completely different names', () => {
    expect(normalizeAndCompareNames('Alice Smith', 'Bob Jones')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatPhoneNumber
// ─────────────────────────────────────────────────────────────────────────────
describe('formatPhoneNumber', () => {
  it('formats a valid Botswana phone number (strips + and space)', () => {
    const result = formatPhoneNumber('+267 71234567');
    expect(result).toBe('26771234567');
  });

  it('throws InternalServerError for an invalid phone number', () => {
    expect(() => formatPhoneNumber('not-a-phone')).toThrow(InternalServerError);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Joi validators
// ─────────────────────────────────────────────────────────────────────────────
describe('Joi validators', () => {
  describe('emailValidation', () => {
    it('accepts a valid email address', () => {
      expect(emailValidation.validate('user@example.com').error).toBeUndefined();
    });
    it('rejects an invalid email address', () => {
      expect(emailValidation.validate('not-an-email').error).toBeDefined();
    });
  });

  describe('urlValidation', () => {
    it('accepts a valid HTTPS URL', () => {
      expect(urlValidation.validate('https://example.com/path').error).toBeUndefined();
    });
    it('rejects an HTTP URL (only HTTPS allowed)', () => {
      expect(urlValidation.validate('http://example.com').error).toBeDefined();
    });
    it('rejects a non-URL string', () => {
      expect(urlValidation.validate('not-a-url').error).toBeDefined();
    });
  });

  describe('mongoIdValidation', () => {
    it('accepts a valid 24-char hex ObjectId', () => {
      expect(mongoIdValidation.validate('507f1f77bcf86cd799439011').error).toBeUndefined();
    });
    it('rejects a non-ObjectId string', () => {
      expect(mongoIdValidation.validate('not-an-id').error).toBeDefined();
    });
  });

  describe('isoDateValidation', () => {
    it('accepts a valid ISO8601 date string', () => {
      expect(isoDateValidation.validate('2024-01-15T10:30:00.000Z').error).toBeUndefined();
    });
    it('rejects a non-ISO date string', () => {
      expect(isoDateValidation.validate('January 15 2024').error).toBeDefined();
    });
  });

  describe('isStringBooleanLike', () => {
    it('accepts the string "true"', () => {
      expect(isStringBooleanLike.validate('true').error).toBeUndefined();
    });
    it('accepts the string "false"', () => {
      expect(isStringBooleanLike.validate('false').error).toBeUndefined();
    });
    it('accepts uppercase "TRUE" (case-insensitive)', () => {
      expect(isStringBooleanLike.validate('TRUE').error).toBeUndefined();
    });
    it('rejects a non-boolean string like "yes"', () => {
      expect(isStringBooleanLike.validate('yes').error).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BAITS API functions (axios mocked)
// ─────────────────────────────────────────────────────────────────────────────
describe('BAITS API functions', () => {
  describe('getAnimalByEID', () => {
    it('returns response data on HTTP 200', async () => {
      axiosGet.mockResolvedValue({ status: 200, data: { animalId: 'A123' } });
      const result = await getAnimalByEID('982 000123456789');
      expect(result).toEqual({ animalId: 'A123' });
    });

    it('throws NotFoundError on HTTP 404', async () => {
      axiosGet.mockResolvedValue({ status: 404 });
      await expect(getAnimalByEID('982 000123456789')).rejects.toThrow(NotFoundError);
    });

    it('throws generic Error on unexpected status code', async () => {
      axiosGet.mockResolvedValue({ status: 500 });
      await expect(getAnimalByEID('982 000123456789')).rejects.toThrow('Invalid response from BAITS API');
    });
  });

  describe('getAnimalByModisarId', () => {
    it('returns response data on HTTP 200', async () => {
      axiosGet.mockResolvedValue({ status: 200, data: { id: 'MOD-1' } });
      await expect(getAnimalByModisarId('MOD-1')).resolves.toEqual({ id: 'MOD-1' });
    });

    it('throws NotFoundError on HTTP 404', async () => {
      axiosGet.mockResolvedValue({ status: 404 });
      await expect(getAnimalByModisarId('MOD-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getAnimalBreedById', () => {
    it('returns breed data on HTTP 200', async () => {
      axiosGet.mockResolvedValue({ status: 200, data: { breedName: 'Brahman' } });
      await expect(getAnimalBreedById(5)).resolves.toEqual({ breedName: 'Brahman' });
    });

    it('throws NotFoundError on HTTP 404', async () => {
      axiosGet.mockResolvedValue({ status: 404 });
      await expect(getAnimalBreedById(5)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getKeeperByRegNumber', () => {
    it('returns keeper data on HTTP 200', async () => {
      axiosGet.mockResolvedValue({ status: 200, data: { keeperId: 'K1' } });
      await expect(getKeeperByRegNumber('REG-001')).resolves.toEqual({ keeperId: 'K1' });
    });

    it('throws NotFoundError on HTTP 404', async () => {
      axiosGet.mockResolvedValue({ status: 404 });
      await expect(getKeeperByRegNumber('REG-001')).rejects.toThrow(NotFoundError);
    });

    it('throws InternalServerError on unexpected status code', async () => {
      axiosGet.mockResolvedValue({ status: 500 });
      await expect(getKeeperByRegNumber('REG-001')).rejects.toThrow(InternalServerError);
    });
  });

  describe('getFarmerByKeeperId', () => {
    it('returns farmer data on HTTP 200', async () => {
      axiosGet.mockResolvedValue({ status: 200, data: { name: 'Farmer John' } });
      await expect(getFarmerByKeeperId(42)).resolves.toEqual({ name: 'Farmer John' });
    });

    it('throws NotFoundError on HTTP 404', async () => {
      axiosGet.mockResolvedValue({ status: 404 });
      await expect(getFarmerByKeeperId(42)).rejects.toThrow(NotFoundError);
    });

    it('throws InternalServerError on unexpected status code', async () => {
      axiosGet.mockResolvedValue({ status: 500 });
      await expect(getFarmerByKeeperId(42)).rejects.toThrow(InternalServerError);
    });
  });

  describe('transferAnimalBetweenKeepers', () => {
    const transferInput = {
      OfficerID: 'OFF-1',
      CurrentHolding: 'HOLD-1',
      CurrentKeeperID: 'KEEP-1',
      NewBrandID: 'BRAND-1',
      NewBrandShapeID: 'SHAPE-1',
      NewKeeperID: 'KEEP-2',
      Remarks: 'Test transfer',
      AnimalTagRegIDs: ['TAG-1', 'TAG-2'],
      SupportingDocument: 'DOC-1',
    };

    it('returns response data on HTTP 200', async () => {
      axiosPost.mockResolvedValue({ status: 200, data: { success: true } });
      await expect(transferAnimalBetweenKeepers(transferInput)).resolves.toEqual({ success: true });
    });

    it('throws NotFoundError on HTTP 404', async () => {
      axiosPost.mockResolvedValue({ status: 404 });
      await expect(transferAnimalBetweenKeepers(transferInput)).rejects.toThrow(NotFoundError);
    });

    it('throws generic Error on unexpected status code', async () => {
      axiosPost.mockResolvedValue({ status: 500 });
      await expect(transferAnimalBetweenKeepers(transferInput)).rejects.toThrow('Invalid response from BAITS API');
    });
  });
});
