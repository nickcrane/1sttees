import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Shared AES-256-GCM at-rest encryption for any secret this app stores in
 * Postgres (the AliExpress OAuth token, admin TOTP secrets, ...). One key
 * (`TOKEN_ENCRYPTION_KEY`) for all of them -- these are all "secrets this
 * server needs to read back", not secrets scoped to one specific subsystem,
 * so a second key per use wouldn't add real isolation, just more key
 * management to get wrong.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getKey(): Buffer {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256, got ${key.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

/** Encrypts to `iv:authTag:ciphertext`, each base64, colon-joined -- one string, safe for a single DB column. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("encrypted secret is malformed (expected iv:authTag:ciphertext)");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
