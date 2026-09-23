import { describe, expect, it } from "vitest";
import { checkRateLimit, waitlistSignupSchema, type RateLimitStore } from "@/lib/waitlist/signup";

/** In-memory fake matching the ioredis subset RateLimitStore needs -- no real Redis in unit tests. */
function createInMemoryStore(): RateLimitStore {
  const values = new Map<string, number>();
  const expiries = new Map<string, number>(); // ms since epoch; absent = no expiry

  function purgeIfExpired(key: string): void {
    const exp = expiries.get(key);
    if (exp !== undefined && Date.now() >= exp) {
      values.delete(key);
      expiries.delete(key);
    }
  }

  return {
    async incr(key) {
      purgeIfExpired(key);
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return next;
    },
    async expire(key, seconds) {
      expiries.set(key, Date.now() + seconds * 1000);
      return 1;
    },
  };
}

describe("checkRateLimit", () => {
  it("allows requests up to the limit and rejects beyond it", async () => {
    const store = createInMemoryStore();
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit("1.2.3.4", store)).toBe(true);
    }
    expect(await checkRateLimit("1.2.3.4", store)).toBe(false);
  });

  it("tracks separate identifiers independently", async () => {
    const store = createInMemoryStore();
    for (let i = 0; i < 5; i++) await checkRateLimit("1.2.3.4", store);
    expect(await checkRateLimit("5.6.7.8", store)).toBe(true);
  });
});

describe("waitlistSignupSchema", () => {
  it("accepts a well-formed email", () => {
    expect(waitlistSignupSchema.safeParse({ email: "golfer@example.com" }).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(waitlistSignupSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a missing email", () => {
    expect(waitlistSignupSchema.safeParse({}).success).toBe(false);
  });
});
