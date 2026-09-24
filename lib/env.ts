import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Next.js loads `.env` on its own before any app code runs, so this is a
 * no-op there (dotenv never overwrites an already-set process.env value).
 * Plain `tsx` entrypoints (the CLI scripts, prisma/seed.ts) have no such
 * built-in loader -- confirmed by running `pnpm ae:product` without this
 * line and getting "DATABASE_URL: expected string, received undefined"
 * despite a populated `.env` sitting right there. Vitest's own test.env
 * (vitest.config.ts) sets its values before this module ever loads, so
 * they win here too, by the same not-already-set rule -- except under
 * Vitest specifically (`process.env.VITEST`, set automatically), where
 * skipping this keeps the suite deterministic regardless of what a
 * developer's local `.env` happens to contain: confirmed a real bug this
 * way -- a test asserting "TOKEN_ENCRYPTION_KEY unset" started silently
 * picking up this machine's real .env key once dotenv-loading was added.
 */
if (!process.env.VITEST) {
  loadDotenv({ quiet: true });
}

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
  ALIEXPRESS_GATEWAY_URL: z.url().default("https://api-sg.aliexpress.com"),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // fixture: reads recorded JSON from ALIEXPRESS_FIXTURES_DIR, no network,
  // no credentials needed -- default, and what CI always runs. live: real
  // calls, needs ALIEXPRESS_APP_KEY/SECRET and an authorized token on file.
  ALIEXPRESS_MODE: z.enum(["fixture", "live"]).default("fixture"),
  ALIEXPRESS_FIXTURES_DIR: z.string().default("./fixtures/aliexpress"),
  ALIEXPRESS_TARGET_CURRENCY: z.string().default("GBP"),
  ALIEXPRESS_TARGET_LANGUAGE: z.string().default("en_US"),
  ALIEXPRESS_SHIP_TO_COUNTRY: z.string().default("GB"),
  ALIEXPRESS_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1000),
  ALIEXPRESS_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
  ALIEXPRESS_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(1000),
  ALIEXPRESS_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(60000),
  // Stage 1 discovery: how many text.search pages to walk per keyword.
  // Default 3 (60 products/keyword vs 20) -- even a single one of these
  // keywords has returned a totalCount in the thousands, so page 1 alone
  // was leaving most of the catalog unseen.
  ALIEXPRESS_DISCOVERY_PAGES_PER_KEYWORD: z.coerce.number().int().positive().default(3),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Test-mode Stripe values, not sandbox/prod -- see docs/decisions.md.
  STORE_BASE_URL: z.url().default("http://localhost:3000"),

  // HMAC key for the guest-cart cookie (spec: "signed cookie") -- separate
  // from TOKEN_ENCRYPTION_KEY (that's AES for values this server needs to
  // read back; this is HMAC for a cookie the browser holds and presents
  // back to us) and from ADMIN_AUTH_SECRET/AUTH_SECRET (unrelated realms).
  // Required, no default -- Phase 3 makes the cart a hard dependency, and a
  // silently-reused placeholder secret is worse than a boot-time failure.
  CART_COOKIE_SECRET: z.string().min(32),

  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).optional(),

  AUTH_SECRET: z.string().optional(),
  CUSTOMER_AUTH_SECRET: z.string().optional(),
  // Google OAuth is the only customer sign-in method (no password) --
  // see docs/decisions.md for why.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ADMIN_AUTH_SECRET: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  ENABLE_SOCIAL_LOGIN: z.enum(["true", "false"]).default("false"),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  RESEND_API_KEY: z.string().optional(),
  SENTRY_DSN: z.url().optional(),

  // Gates the whole public storefront behind /coming-soon via
  // middleware.ts (admin stays reachable) -- read directly off
  // process.env there instead of this singleton, since middleware.ts
  // runs on the Edge runtime and this module isn't Edge-safe (see its
  // own dotenv comment above). Kept here too so app code (e.g. the
  // coming-soon page itself, if it ever needs to know) has one place to
  // read it from consistently.
  COMING_SOON_MODE: z.enum(["true", "false"]).default("false"),

  // Catalog discovery pipeline (docs/product-flow.md) -- classification
  // (Stage 2) and listing generation (Stage 4) both call Claude for
  // structured output. Optional for now so the app still boots without it;
  // the pipeline's own code fails loudly if a call is attempted with none
  // set, rather than this being a hard boot-time requirement everywhere.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  STORE_CURRENCY: z.string().default("GBP"),
  VAT_MODE: z.enum(["NOT_REGISTERED", "REGISTERED"]).default("NOT_REGISTERED"),
  VAT_NUMBER: z.string().optional(),

  ORDER_HOLD_MINUTES: z.coerce.number().int().nonnegative().default(30),
  MIN_MARGIN_PCT: z.coerce.number().default(20),
  PRICE_DRIFT_TOLERANCE_PCT: z.coerce.number().default(10),
  FX_BUFFER_PCT: z.coerce.number().default(3),
  // Stripe UK card rate as of this writing (~1.5% + 20p) -- kept
  // configurable rather than hardcoded since processor rates change and
  // this feeds straight into the landed-cost calculation.
  PAYMENT_PROCESSING_PCT: z.coerce.number().default(1.5),
  PAYMENT_PROCESSING_FIXED_PENCE: z.coerce.number().default(20),
  // Not given a number by the spec (just "configurable %") -- 2% is a
  // conservative estimate for a cheap, low-fragility, low-return-rate
  // product line (golf tees); tune via admin once real return data exists.
  RETURNS_RESERVE_PCT: z.coerce.number().default(2),

  ADMIN_TOTP_ISSUER: z.string().default("1st Tees Admin"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * A truly blank `KEY=` line in `.env` (the idiomatic way `.env.example`
 * documents an optional, unset field) comes through `process.env` as an
 * empty string, not `undefined` -- which `.optional()` doesn't treat as
 * "not set". Strip blank strings before validating so an unset optional
 * field behaves like it's actually unset, rather than "present but invalid"
 * for anything typed as `.url()`/`.enum()`/etc. Confirmed this actually
 * happens: importing Prisma triggers its own dotenv auto-load, merging
 * `.env`'s blank optional fields into process.env even in a test run that
 * never touched `.env` itself.
 */
function stripBlankValues(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") result[key] = value;
  }
  return result;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(stripBlankValues(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
