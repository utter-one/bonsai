import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Result of encrypting a secret value */
export type EncryptedSecret = {
  encryptedValue: string;
  iv: string;
  tag: string;
};

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param plaintext - The secret value to encrypt
 * @param masterKey - 32-byte master key Buffer
 * @returns Base64-encoded encrypted value, IV, and authentication tag
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted secret.
 * @param encryptedValue - Base64-encoded ciphertext
 * @param iv - Base64-encoded initialization vector
 * @param tag - Base64-encoded authentication tag
 * @param masterKey - 32-byte master key Buffer
 * @returns Decrypted plaintext string
 * @throws If the tag verification fails (tampered or wrong key)
 */
export function decryptSecret(encryptedValue: string, iv: string, tag: string, masterKey: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64').subarray(0, TAG_BYTES));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Fixed application-specific salt for bundle key derivation — prevents cross-application rainbow tables. */
const BUNDLE_KEY_SALT = Buffer.from('bonsai-migration-bundle-v1');

/**
 * Derives a 32-byte AES-256-GCM key from an arbitrary-length bundle password using scrypt.
 * Uses a fixed application-specific salt; security comes from the password itself.
 * @param password - Bundle password provided by the caller (any non-empty string)
 * @returns 32-byte Buffer suitable for use with encryptSecret / decryptSecret
 */
export function deriveBundleKey(password: string): Buffer {
  return scryptSync(password, BUNDLE_KEY_SALT, 32) as Buffer;
}

/**
 * Parses a master key from a hex or base64 string into a 32-byte Buffer.
 * Accepts 64-char hex or 44-char base64 (both encode 32 bytes).
 * @param raw - The raw key string from the environment variable
 * @returns 32-byte key Buffer
 * @throws If the value is missing or does not encode exactly 32 bytes
 */
export function parseMasterKey(raw: string): Buffer {
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.byteLength !== 32) {
    throw new Error(`MASTER_ENCRYPTION_KEY must encode exactly 32 bytes (got ${buf.byteLength}). Use a 64-char hex or 44-char base64 string.`);
  }
  return buf;
}
