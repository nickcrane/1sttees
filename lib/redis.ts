import Redis from "ioredis";
import { env } from "@/lib/env";

// Reused across hot reloads in dev, same reasoning as lib/prisma.ts.
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
