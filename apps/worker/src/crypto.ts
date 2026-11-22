import crypto from "node:crypto";

const IV_LENGTH_BYTES = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit auth tag

/**
 * Validate and parse a 64-hex-character string into a 32-byte key Buffer.
 */
export function parseEncryptionKey(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey.trim(), "hex");
  if (buf.length !== 32) {
    throw new Error(
      `TOKEN_ENC_KEY must be exactly 32 bytes (64 hex characters), received ${buf.length} bytes`
    );
  }
  return buf;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Packed format: [12-byte IV] + [16-byte Auth Tag] + [Ciphertext]
 */
export function encryptToken(plainText: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a packed AES-256-GCM Buffer back to plaintext string.
 * Expects: [12-byte IV] + [16-byte Auth Tag] + [Ciphertext]
 */
export function decryptToken(packed: Buffer, key: Buffer): string {
  if (packed.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new Error("Invalid encrypted payload: too short to contain IV and Auth Tag");
  }

  const iv = packed.subarray(0, IV_LENGTH_BYTES);
  const authTag = packed.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES
  );
  const cipherText = packed.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return (
    decipher.update(cipherText, undefined, "utf8") +
    decipher.final("utf8")
  );
}
