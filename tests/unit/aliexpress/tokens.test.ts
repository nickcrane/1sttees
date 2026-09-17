import { describe, expect, it } from "vitest";
import { resolveTokenToPersist } from "@/lib/aliexpress/tokens";

const NOW = 1_700_000_000_000;

describe("resolveTokenToPersist", () => {
  it("uses the response's own refresh_token when present", () => {
    const resolved = resolveTokenToPersist(
      { access_token: "new-access", refresh_token: "new-refresh", expires_in: 86400, refresh_expires_in: 172800 },
      null,
      NOW
    );
    expect(resolved.refreshToken).toBe("new-refresh");
    expect(resolved.expiresAt.getTime()).toBe(NOW + 86400_000);
    expect(resolved.refreshExpiresAt.getTime()).toBe(NOW + 172800_000);
  });

  it("keeps the existing refresh_token when a refresh response omits it, instead of nulling it out", () => {
    // Regression test for a real incident: aliexpress-dashboard hit exactly
    // this once -- a refresh response that didn't repeat refresh_token
    // overwrote the stored value with null, permanently breaking every
    // subsequent refresh until a full re-authorization.
    const existing = {
      accessToken: "old-access",
      refreshToken: "still-good-refresh",
      expiresAt: new Date(NOW - 1000),
      refreshExpiresAt: new Date(NOW + 100_000_000),
    };
    const resolved = resolveTokenToPersist(
      { access_token: "new-access", expires_in: 86400 }, // no refresh_token in the response
      existing,
      NOW
    );
    expect(resolved.refreshToken).toBe("still-good-refresh");
    expect(resolved.accessToken).toBe("new-access");
  });

  it("keeps the existing refresh_expires_in when the response omits it too", () => {
    const existing = {
      accessToken: "old-access",
      refreshToken: "still-good-refresh",
      expiresAt: new Date(NOW - 1000),
      refreshExpiresAt: new Date(NOW + 50_000),
    };
    const resolved = resolveTokenToPersist({ access_token: "new-access", expires_in: 86400 }, existing, NOW);
    expect(resolved.refreshExpiresAt.getTime()).toBe(NOW + 50_000);
  });

  it("throws if there is no refresh_token anywhere -- refuses to save a dead-end token set", () => {
    expect(() => resolveTokenToPersist({ access_token: "new-access", expires_in: 86400 }, null, NOW)).toThrow(
      /refresh_token/
    );
  });
});
