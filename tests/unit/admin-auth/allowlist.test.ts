import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importAllowlistWith(adminEmails: string | undefined) {
  vi.resetModules();
  vi.stubEnv("ADMIN_EMAILS", adminEmails as string);
  return import("@/lib/admin-auth/allowlist");
}

describe("isAllowlistedAdminEmail", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows an email present in the comma-separated list", async () => {
    const { isAllowlistedAdminEmail } = await importAllowlistWith("a@example.com,b@example.com");
    expect(isAllowlistedAdminEmail("a@example.com")).toBe(true);
    expect(isAllowlistedAdminEmail("b@example.com")).toBe(true);
  });

  it("rejects an email not in the list", async () => {
    const { isAllowlistedAdminEmail } = await importAllowlistWith("a@example.com");
    expect(isAllowlistedAdminEmail("stranger@example.com")).toBe(false);
  });

  it("is case-insensitive", async () => {
    const { isAllowlistedAdminEmail } = await importAllowlistWith("Admin@Example.com");
    expect(isAllowlistedAdminEmail("admin@example.com")).toBe(true);
  });

  it("tolerates whitespace around entries in the list", async () => {
    const { isAllowlistedAdminEmail } = await importAllowlistWith(" a@example.com , b@example.com ");
    expect(isAllowlistedAdminEmail("b@example.com")).toBe(true);
  });

  it("rejects everything when ADMIN_EMAILS is unset", async () => {
    const { isAllowlistedAdminEmail } = await importAllowlistWith(undefined);
    expect(isAllowlistedAdminEmail("anyone@example.com")).toBe(false);
  });
});
