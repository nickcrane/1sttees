import { z } from "zod";

/**
 * Env vars are validated in full up front (see docs/decisions.md), but only
 * the fields a subsystem actually built so far requires are `.min(1)`/etc —
 * the rest stay `.optional()` until the phase that wires them up tightens
 * them. This lets `pnpm dev` run on a minimal `.env` today without silently
 * accepting a broken value once a field's requirement does apply.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  ALIEXPRESS_APP_KEY: z.string().optional(),
  ALIEXPRESS_APP_SECRET: z.string().optional(),
  ALIEXPRESS_CALLBACK_URL: z.url().optional(),
  ALIEXPRESS_GATEWAY_URL: z.url().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).optional(),

  AUTH_SECRET: z.string().optional(),
  CUSTOMER_AUTH_SECRET: z.string().optional(),
  ADMIN_AUTH_SECRET: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  ENABLE_SOCIAL_LOGIN: z.enum(["true", "false"]).default("false"),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  RESEND_API_KEY: z.string().optional(),
  SENTRY_DSN: z.url().optional(),

  STORE_CURRENCY: z.string().default("GBP"),
  VAT_MODE: z.enum(["NOT_REGISTERED", "REGISTERED"]).default("NOT_REGISTERED"),
  VAT_NUMBER: z.string().optional(),

  ORDER_HOLD_MINUTES: z.coerce.number().int().nonnegative().default(30),
  MIN_MARGIN_PCT: z.coerce.number().default(20),
  PRICE_DRIFT_TOLERANCE_PCT: z.coerce.number().default(10),
  FX_BUFFER_PCT: z.coerce.number().default(3),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
