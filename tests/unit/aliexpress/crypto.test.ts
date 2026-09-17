import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = randomBytes(32).toString("base64");

async function importCryptoWithKey(key: string | undefined) {
  vi.resetModules();
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", key as string);
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  return import("@/lib/aliexpress/crypto");
}

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a plaintext string", async () => {
    const { encryptSecret, decryptSecret } = await importCryptoWithKey(TEST_KEY);
    const encrypted = encryptSecret("my-secret-access-token");
    expect(encrypted).not.toContain("my-secret-access-token");
    expect(decryptSecret(encrypted)).toBe("my-secret-access-token");
  });

  it("produces a different ciphertext each time (random IV), but both decrypt correctly", async () => {
    const { encryptSecret, decryptSecret } = await importCryptoWithKey(TEST_KEY);
    const a = encryptSecret("same-plaintext");
    const b = encryptSecret("same-plaintext");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-plaintext");
    expect(decryptSecret(b)).toBe("same-plaintext");
  });

  it("throws a clear error when TOKEN_ENCRYPTION_KEY is unset", async () => {
    const { encryptSecret } = await importCryptoWithKey(undefined);
    expect(() => encryptSecret("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("throws if the stored ciphertext has been tampered with (auth tag check)", async () => {
    const { encryptSecret, decryptSecret } = await importCryptoWithKey(TEST_KEY);
    const encrypted = encryptSecret("tamper-test");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const tampered = [iv, authTag, Buffer.from("tampered").toString("base64")].join(":");
    void ciphertext;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
