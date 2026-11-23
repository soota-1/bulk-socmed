import { describe, it, expect } from "vitest";
import { parseEncryptionKey, encryptToken, decryptToken } from "../src/crypto";

describe("shared crypto — parseEncryptionKey", () => {
  it("parses valid 64-hex-character string into 32-byte Buffer", () => {
    const validHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const key = parseEncryptionKey(validHex);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("throws on key that is too short", () => {
    expect(() => parseEncryptionKey("abcd")).toThrow(/32 bytes/);
  });
});

describe("shared crypto — encryptToken & decryptToken round-trip", () => {
  const sampleKey = parseEncryptionKey(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );

  it("successfully encrypts and decrypts OAuth tokens", () => {
    const token = "ya29.a0AfH6SMD_very_secret_oauth_token_from_google";
    const encrypted = encryptToken(token, sampleKey);

    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.length).toBe(token.length + 28); // 12B IV + 16B Auth Tag

    const decrypted = decryptToken(encrypted, sampleKey);
    expect(decrypted).toBe(token);
  });

  it("throws on tampered ciphertext", () => {
    const token = "secret_access_token";
    const encrypted = encryptToken(token, sampleKey);

    // Tamper with ciphertext
    encrypted[encrypted.length - 1] ^= 1;

    expect(() => decryptToken(encrypted, sampleKey)).toThrow();
  });
});
