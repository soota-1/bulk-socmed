import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken, parseEncryptionKey } from "../src/crypto.js";

describe("crypto — AES-256-GCM token encryption", () => {
  // 32-byte (64 hex characters) key
  const validHexKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const key = parseEncryptionKey(validHexKey);

  it("encrypts and decrypts OAuth token back to original plaintext", () => {
    const originalToken = "ya29.a0AfH6SMB_random_oauth_token_1234567890";
    const encrypted = encryptToken(originalToken, key);
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    // In AES-GCM, ciphertext length equals plaintext length + 12B IV + 16B Tag = 28B overhead
    expect(encrypted.length).toBe(originalToken.length + 28);

    const decrypted = decryptToken(encrypted, key);
    expect(decrypted).toBe(originalToken);
  });

  it("throws error when decrypting with wrong key", () => {
    const wrongHexKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const wrongKey = parseEncryptionKey(wrongHexKey);

    const encrypted = encryptToken("secret_token_abc", key);
    expect(() => decryptToken(encrypted, wrongKey)).toThrow();
  });

  it("throws error when ciphertext or auth tag is corrupted", () => {
    const encrypted = encryptToken("tamper_test_token", key);
    // Corrupt one byte in the payload
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => decryptToken(encrypted, key)).toThrow();
  });

  it("parseEncryptionKey validates 32-byte (64 hex) length", () => {
    expect(() => parseEncryptionKey("tooshort")).toThrow(/32 bytes/);
    expect(key.length).toBe(32);
  });
});
