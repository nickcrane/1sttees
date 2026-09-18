import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clearFailedSignIns,
  getLockoutRemainingSeconds,
  recordFailedSignIn,
  type RateLimitStore,
} from "@/lib/admin-auth/rate-limit";

/** In-memory fake matching the ioredis subset RateLimitStore needs -- no real Redis in unit tests. */
function createInMemoryStore(): RateLimitStore {
  const values = new Map<string, string>();
  const expiries = new Map<string, number>(); // ms since epoch; absent = no expiry

  function isExpired(key: string): boolean {
    const exp = expiries.get(key);
    if (exp === undefined) return false;
    return Date.now() >= exp;
  }
  function purgeIfExpired(key: string): void {
    if (isExpired(key)) {
      values.delete(key);
      expiries.delete(key);
    }
  }

  return {
    async incr(key) {
      purgeIfExpired(key);
      const next = (Number(values.get(key)) || 0) + 1;
      values.set(key, String(next));
      return next;
    },
    async expire(key, seconds) {
      expiries.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    async set(key, value, _mode, seconds) {
      values.set(key, value);
      expiries.set(key, Date.now() + seconds * 1000);
      return "OK";
    },
    async ttl(key) {
      purgeIfExpired(key);
      if (!values.has(key)) return -2;
      const exp = expiries.get(key);
      if (exp === undefined) return -1;
      return Math.ceil((exp - Date.now()) / 1000);
    },
    async del(...keys) {
      let count = 0;
      for (const key of keys) {
        if (values.delete(key)) count++;
        expiries.delete(key);
      }
      return count;
    },
  };
}

describe("recordFailedSignIn / getLockoutRemainingSeconds", () => {
  it("does not lock out before the threshold", async () => {
    const store = createInMemoryStore();
    await recordFailedSignIn("test@example.com", store);
    await recordFailedSignIn("test@example.com", store);
    expect(await getLockoutRemainingSeconds("test@example.com", store)).toBe(0);
  });

  it("locks out once the failure threshold is reached", async () => {
    const store = createInMemoryStore();
    await recordFailedSignIn("test@example.com", store);
    await recordFailedSignIn("test@example.com", store);
    await recordFailedSignIn("test@example.com", store); // 3rd failure -- threshold
    const remaining = await getLockoutRemainingSeconds("test@example.com", store);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it("increases the lockout duration exponentially with repeated failures", async () => {
    const store = createInMemoryStore();
    for (let i = 0; i < 4; i++) await recordFailedSignIn("test@example.com", store);
    // 4th failure (1 past threshold): 30 * 2^1 = 60s
    const remaining = await getLockoutRemainingSeconds("test@example.com", store);
    expect(remaining).toBeGreaterThan(30);
    expect(remaining).toBeLessThanOrEqual(60);
  });

  it("keeps failure counts independent per identifier", async () => {
    const store = createInMemoryStore();
    await recordFailedSignIn("a@example.com", store);
    await recordFailedSignIn("a@example.com", store);
    await recordFailedSignIn("a@example.com", store);
    expect(await getLockoutRemainingSeconds("b@example.com", store)).toBe(0);
  });
});

describe("clearFailedSignIns", () => {
  it("resets both the failure count and any active lockout", async () => {
    const store = createInMemoryStore();
    await recordFailedSignIn("test@example.com", store);
    await recordFailedSignIn("test@example.com", store);
    await recordFailedSignIn("test@example.com", store);
    expect(await getLockoutRemainingSeconds("test@example.com", store)).toBeGreaterThan(0);

    await clearFailedSignIns("test@example.com", store);
    expect(await getLockoutRemainingSeconds("test@example.com", store)).toBe(0);

    // and the count is genuinely reset, not just the lockout key -- three
    // more failures should lock out again rather than continuing to escalate
    await recordFailedSignIn("test@example.com", store);
    await recordFailedSignIn("test@example.com", store);
    expect(await getLockoutRemainingSeconds("test@example.com", store)).toBe(0);
  });
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit and rejects beyond it", async () => {
    const store = createInMemoryStore();
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit("1.2.3.4", 5, 60, store)).toBe(true);
    }
    expect(await checkRateLimit("1.2.3.4", 5, 60, store)).toBe(false);
  });

  it("tracks separate identifiers independently", async () => {
    const store = createInMemoryStore();
    for (let i = 0; i < 5; i++) await checkRateLimit("1.2.3.4", 5, 60, store);
    expect(await checkRateLimit("5.6.7.8", 5, 60, store)).toBe(true);
  });
});
