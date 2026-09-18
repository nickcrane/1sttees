import Redis from "ioredis";
import { env } from "@/lib/env";

/**
 * A dedicated connection for BullMQ, separate from lib/redis.ts's
 * general-purpose client. BullMQ's own docs discourage sharing one
 * connection between its Workers (which hold blocking commands open) and
 * unrelated app code (rate-limiting/lockout counters here) -- reusing
 * lib/redis.ts's client would let a blocked Worker connection starve
 * those callers.
 */
export const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
