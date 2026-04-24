import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { SEALED_BID_ENCRYPTION_KEY } from '../globals';

/**
 * AES-256-GCM encryption for sealed bid amounts.
 *
 * Why AES-256-GCM?
 *  - GCM is authenticated encryption — the auth tag detects tampering.
 *  - A fresh 12-byte IV per encryption means identical amounts produce
 *    different ciphertext, preventing frequency analysis.
 *  - The decryption call throws if the tag doesn't match, so a corrupt or
 *    tampered ciphertext can never silently return a wrong amount.
 *
 * Wire format stored in bidAmountEncrypted:
 *   <12-byte IV (hex)>:<16-byte auth tag (hex)>:<ciphertext (hex)>
 *
 * Key requirement:
 *   SEALED_BID_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).
 *   Store it in a secrets manager; never commit it to source control.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV — NIST recommended length for GCM
const TAG_BYTES = 16;  // 128-bit auth tag — GCM default

function getKey(): Buffer {
  const hexKey = SEALED_BID_ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(
      'SEALED_BID_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypt a bid amount.
 *
 * @param amount  The plaintext bid amount (number).
 * @returns       Opaque ciphertext string to store in the database.
 */
export function encryptBidAmount(amount: number): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = amount.toString();
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a bid amount.
 *
 * @param ciphertext  The value previously returned by `encryptBidAmount`.
 * @returns           The original plaintext amount as a number.
 * @throws            If the ciphertext is malformed or the auth tag fails.
 */
export function decryptBidAmount(ciphertext: string): number {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid sealed bid ciphertext format');
  }

  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invalid sealed bid ciphertext: wrong IV or tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const amount = parseFloat(decrypted.toString('utf8'));

  if (isNaN(amount)) {
    throw new Error('Decrypted sealed bid amount is not a valid number');
  }

  return amount;
}
