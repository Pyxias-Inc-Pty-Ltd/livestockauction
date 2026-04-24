import { encryptBidAmount, decryptBidAmount } from '../../../src/shared/bid-crypto';

describe('bid-crypto', () => {

  describe('encryptBidAmount / decryptBidAmount round-trips', () => {

    it('round-trips a positive integer', () => {
      expect(decryptBidAmount(encryptBidAmount(5000))).toBe(5000);
    });

    it('round-trips a floating-point amount', () => {
      expect(decryptBidAmount(encryptBidAmount(1234.56))).toBe(1234.56);
    });

    it('round-trips zero', () => {
      expect(decryptBidAmount(encryptBidAmount(0))).toBe(0);
    });

    it('round-trips a large amount', () => {
      expect(decryptBidAmount(encryptBidAmount(9_999_999))).toBe(9_999_999);
    });

  });

  describe('encryptBidAmount uniqueness', () => {

    it('produces different ciphertext for the same amount (fresh IV each call)', () => {
      const ct1 = encryptBidAmount(9999);
      const ct2 = encryptBidAmount(9999);
      expect(ct1).not.toBe(ct2);
    });

  });

  describe('ciphertext format', () => {

    it('has exactly 3 colon-separated parts', () => {
      const parts = encryptBidAmount(100).split(':');
      expect(parts).toHaveLength(3);
    });

    it('IV part is 24 hex chars (12 bytes)', () => {
      const [iv] = encryptBidAmount(100).split(':');
      expect(iv).toMatch(/^[0-9a-f]{24}$/);
    });

    it('auth-tag part is 32 hex chars (16 bytes)', () => {
      const [, tag] = encryptBidAmount(100).split(':');
      expect(tag).toMatch(/^[0-9a-f]{32}$/);
    });

  });

  describe('decryptBidAmount error cases', () => {

    it('throws on wrong number of parts', () => {
      expect(() => decryptBidAmount('not-valid')).toThrow(
        'Invalid sealed bid ciphertext format',
      );
    });

    it('throws when IV or tag buffers are the wrong length', () => {
      // Two-byte hex strings instead of the required 24 / 32 char hex strings
      expect(() => decryptBidAmount('aabb:ccdd:eeff')).toThrow(
        'Invalid sealed bid ciphertext: wrong IV or tag length',
      );
    });

    it('throws on a tampered ciphertext (GCM auth-tag mismatch)', () => {
      const ct = encryptBidAmount(1000);
      const parts = ct.split(':');
      // Replace the last character of the ciphertext portion to corrupt it
      const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -1)}f`;
      expect(() => decryptBidAmount(tampered)).toThrow();
    });

  });

});
