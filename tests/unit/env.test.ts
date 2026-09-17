import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MINIMAL_VALID_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

// lib/env.ts parses process.env and throws at *import* time, so each test
// stubs process.env then re-imports the module fresh via vi.resetModules()
// rather than importing it once at the top of the file.
async function importEnvWith(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", undefined as unknown as string);
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value as string);
  }
  return import("@/lib/env");
}

describe("env", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads successfully with a minimal valid config and applies defaults", async () => {
    const { env } = await importEnvWith(MINIMAL_VALID_ENV);
    expect(env.DATABASE_URL).toBe(MINIMAL_VALID_ENV.DATABASE_URL);
    expect(env.STORE_CURRENCY).toBe("GBP");
    expect(env.VAT_MODE).toBe("NOT_REGISTERED");
    expect(env.ORDER_HOLD_MINUTES).toBe(30);
  });

  it("throws a readable error when DATABASE_URL is missing", async () => {
    await expect(
      importEnvWith({ REDIS_URL: MINIMAL_VALID_ENV.REDIS_URL })
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a URL", async () => {
    await expect(
      importEnvWith({ ...MINIMAL_VALID_ENV, DATABASE_URL: "not-a-url" })
    ).rejects.toThrow(/Invalid environment configuration/);
  });

  it("coerces numeric env vars from their string form", async () => {
    const { env } = await importEnvWith({
      ...MINIMAL_VALID_ENV,
      ORDER_HOLD_MINUTES: "45",
      MIN_MARGIN_PCT: "15.5",
    });
    expect(env.ORDER_HOLD_MINUTES).toBe(45);
    expect(env.MIN_MARGIN_PCT).toBe(15.5);
  });

  it("rejects an unknown VAT_MODE", async () => {
    await expect(
      importEnvWith({ ...MINIMAL_VALID_ENV, VAT_MODE: "SOMETHING_ELSE" })
    ).rejects.toThrow();
  });
});
