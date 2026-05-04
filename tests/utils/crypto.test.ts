import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, parseMasterKey } from '../../src/utils/crypto';

describe('parseMasterKey', () => {
  const validHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  const validBase64 = Buffer.from(validHex, 'hex').toString('base64');

  it('parses a valid 64-char hex key', () => {
    const buf = parseMasterKey(validHex);
    expect(buf.byteLength).toBe(32);
    expect(buf.equals(Buffer.from(validHex, 'hex'))).toBe(true);
  });

  it('parses a valid base64 key', () => {
    const buf = parseMasterKey(validBase64);
    expect(buf.byteLength).toBe(32);
    expect(buf.equals(Buffer.from(validHex, 'hex'))).toBe(true);
  });

  it('throws for a key that does not encode 32 bytes', () => {
    const shortHex = '0011223344556677';
    expect(() => parseMasterKey(shortHex)).toThrow('must encode exactly 32 bytes');
  });

  it('throws for an empty string', () => {
    expect(() => parseMasterKey('')).toThrow('must encode exactly 32 bytes');
  });

  it('throws for a non-hex, non-base64 string that produces wrong length', () => {
    expect(() => parseMasterKey('notavalidkey')).toThrow('must encode exactly 32 bytes');
  });
});

describe('encryptSecret / decryptSecret', () => {
  const masterKey = Buffer.alloc(32, 0xab);

  it('round-trips a simple string', () => {
    const plaintext = 'my-secret-value';
    const encrypted = encryptSecret(plaintext, masterKey);
    expect(encrypted.encryptedValue).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();

    const decrypted = decryptSecret(encrypted.encryptedValue, encrypted.iv, encrypted.tag, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    const encrypted = encryptSecret('', masterKey);
    const decrypted = decryptSecret(encrypted.encryptedValue, encrypted.iv, encrypted.tag, masterKey);
    expect(decrypted).toBe('');
  });

  it('round-trips a long string', () => {
    const plaintext = 'a'.repeat(10000);
    const encrypted = encryptSecret(plaintext, masterKey);
    const decrypted = decryptSecret(encrypted.encryptedValue, encrypted.iv, encrypted.tag, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips unicode characters', () => {
    const plaintext = 'Hello \u4e16\u754c \ud83d\ude00';
    const encrypted = encryptSecret(plaintext, masterKey);
    const decrypted = decryptSecret(encrypted.encryptedValue, encrypted.iv, encrypted.tag, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-text';
    const enc1 = encryptSecret(plaintext, masterKey);
    const enc2 = encryptSecret(plaintext, masterKey);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.encryptedValue).not.toBe(enc2.encryptedValue);
  });

  it('throws on wrong key', () => {
    const plaintext = 'secret';
    const encrypted = encryptSecret(plaintext, masterKey);
    const wrongKey = Buffer.alloc(32, 0xff);
    expect(() => decryptSecret(encrypted.encryptedValue, encrypted.iv, encrypted.tag, wrongKey)).toThrow();
  });

  it('throws on tampered ciphertext', () => {
    const plaintext = 'secret';
    const encrypted = encryptSecret(plaintext, masterKey);
    const buf = Buffer.from(encrypted.encryptedValue, 'base64');
    buf[0] ^= 0x01;
    const tampered = buf.toString('base64');
    expect(() => decryptSecret(tampered, encrypted.iv, encrypted.tag, masterKey)).toThrow();
  });

  it('throws on tampered tag', () => {
    const plaintext = 'secret';
    const encrypted = encryptSecret(plaintext, masterKey);
    const tagBuf = Buffer.from(encrypted.tag, 'base64');
    tagBuf[0] ^= 0x01;
    const badTag = tagBuf.toString('base64');
    expect(() => decryptSecret(encrypted.encryptedValue, encrypted.iv, badTag, masterKey)).toThrow();
  });

  it('encrypted values are base64-encoded strings', () => {
    const encrypted = encryptSecret('test', masterKey);
    expect(() => Buffer.from(encrypted.encryptedValue, 'base64')).not.toThrow();
    expect(() => Buffer.from(encrypted.iv, 'base64')).not.toThrow();
    expect(() => Buffer.from(encrypted.tag, 'base64')).not.toThrow();
  });
});
