import { redis } from "@/lib/redis";

/** The subset of ioredis's API this module needs -- lets tests inject an in-memory fake instead of a real Redis connection. */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<string | null>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

const FAILURE_WINDOW_SECONDS = 15 * 60;
const LOCKOUT_THRESHOLD = 3;
const LOCKOUT_BASE_SECONDS = 30;

function failuresKey(identifier: string): string {
  return `admin-auth:failures:${identifier}`;
}
function lockoutKey(identifier: string): string {
  return `admin-auth:lockout:${identifier}`;
}

/** Call on every failed sign-in attempt (per email AND per IP -- call twice with different identifiers). Locks out with exponential cooldown once the threshold is hit. */
export async function recordFailedSignIn(identifier: string, store: RateLimitStore = redis): Promise<void> {
  const key = failuresKey(identifier);
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, FAILURE_WINDOW_SECONDS);
  if (count >= LOCKOUT_THRESHOLD) {
    const lockoutSeconds = LOCKOUT_BASE_SECONDS * 2 ** (count - LOCKOUT_THRESHOLD);
    await store.set(lockoutKey(identifier), "1", "EX", lockoutSeconds);
  }
}

export async function clearFailedSignIns(identifier: string, store: RateLimitStore = redis): Promise<void> {
  await store.del(failuresKey(identifier), lockoutKey(identifier));
}

/** Seconds remaining in a lockout, or 0 if not locked out. */
export async function getLockoutRemainingSeconds(identifier: string, store: RateLimitStore = redis): Promise<number> {
  const ttl = await store.ttl(lockoutKey(identifier));
  return ttl > 0 ? ttl : 0;
}

/** Plain per-window request throttle (distinct from lockout) -- one call per auth-route request, per identifier. */
export async function checkRateLimit(
  identifier: string,
  limitPerWindow: number,
  windowSeconds: number,
  store: RateLimitStore = redis
): Promise<boolean> {
  const key = `admin-auth:rate:${identifier}`;
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, windowSeconds);
  return count <= limitPerWindow;
}
