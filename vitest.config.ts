import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // vitest doesn't read .env the way `next dev`/prisma do -- process.env is
    // otherwise empty here, which would crash every test that imports
    // lib/env.ts transitively (client.ts, prisma.ts, logger.ts, ...) before
    // it even runs. Deliberately hardcoded rather than loaded from .env: the
    // suite must stay deterministic regardless of a developer's local .env
    // contents. This TOKEN_ENCRYPTION_KEY is test-only, not a real secret.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      TOKEN_ENCRYPTION_KEY: "HrTN3HKhsNkkt2F0uNGjltc94fVAfCda5cGlkiemUSs=", // gitleaks:allow -- fake, test-only, not a real secret
      CART_COOKIE_SECRET: "test-only-cart-cookie-secret-not-a-real-value-x", // gitleaks:allow -- fake, test-only, not a real secret
      ALIEXPRESS_MODE: "fixture",
    },
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      // Thin Prisma wrappers with no branching logic of their own to unit
      // test in isolation (the logic worth testing -- resolveTokenToPersist,
      // encryption -- already is, elsewhere); exercised by the e2e suite
      // against a real database instead.
      exclude: [
        "lib/prisma.ts",
        "lib/aliexpress/prismaTokenStore.ts",
        // Orchestration heavily coupled to Prisma (many sequential
        // upserts/finds) -- the pure logic it calls out to (slug.ts,
        // parse-product-id.ts, pricing/calculate.ts) is unit tested;
        // pricing-rules.ts itself is verified against a real database
        // instead of a mocked Prisma client, which wouldn't exercise real
        // upsert/unique-constraint semantics anyway.
        "lib/catalog/pricing-rules.ts",
        // Same rationale, and also owns retry/continue-on-error control
        // flow across a whole discovery run that's more honestly verified
        // by actually running it (see docs/decisions.md) than by mocking
        // both the AliExpress client and Prisma.
        "lib/catalog/discovery.ts",
        // Same rationale as discovery.ts -- Prisma orchestration plus a
        // call to Claude. The pure routing rule it delegates to
        // (classify-decision.ts) is unit tested directly; this shell is
        // verified live with a stubbed classifier response against the
        // real database (see docs/decisions.md), since there's no
        // "fixture mode" for the Anthropic call the way
        // ALIEXPRESS_MODE=fixture covers discovery.ts.
        "lib/catalog/classify.ts",
        // Prisma + auth() orchestration ("use server" actions) -- same
        // rationale as classify.ts. The pure transition table it
        // validates against (curation-transitions.ts) is unit tested
        // directly; this shell needs a real database and admin session to
        // exercise meaningfully, verified live (see docs/decisions.md).
        "lib/catalog/curation-actions.ts",
        // Same rationale as classify.ts -- Prisma orchestration plus a
        // call to Claude. The pure validator it calls out to
        // (listing-validator.ts) is unit tested directly; this shell is
        // verified live with a stubbed classifier response against the
        // real database (see docs/decisions.md).
        "lib/catalog/listing.ts",
        // Thin Prisma query wrappers (findMany/findFirst with a fixed
        // include/where) -- no branching logic of their own; exercised by
        // the e2e storefront-browsing flow against a real database.
        "lib/catalog/products.ts",
        "lib/admin-auth/config.ts",
        "lib/admin-auth/setup.ts",
        "lib/admin-auth/security-events.ts",
        // Thin next/headers cookies() wrapper -- nothing to unit test without
        // a request context; covered by the e2e cart flow instead.
        "lib/cart/cookie.ts",
        // Prisma orchestration (get-or-create, upsert/update/delete by
        // cartId+id) -- same rationale as pricing-rules.ts above. The pure
        // logic it doesn't own (signed-cart-id.ts, calculateCartTotals) is
        // unit tested directly; the rest is verified against a real
        // database via the e2e checkout flow.
        "lib/cart/cart.ts",
        // "use server" mutations -- thin wrappers around lib/cart/cart.ts
        // (validate FormData, delegate, revalidatePath); no branching logic
        // of their own to unit test, and next/cache's revalidatePath needs
        // a request context this suite doesn't have. Exercised by the e2e
        // add-to-cart/drawer flow instead.
        "lib/cart/actions.ts",
        // Prisma orchestration (order creation, payment-event application) --
        // same rationale as lib/cart/cart.ts above. The pure amount
        // recomputation it delegates to (calculate-totals.ts,
        // order-number.ts) is unit tested directly; the rest needs a real
        // database and is exercised by the e2e checkout flow.
        "lib/orders/create-order.ts",
        "lib/orders/confirm-payment.ts",
        "lib/orders/checkout-actions.ts",
        // Route-handler glue (dedup check, WebhookEvent write, delegate) --
        // no branching logic of its own; exercised by the e2e checkout flow
        // once real Stripe/PayPal test credentials are wired in.
        "lib/payments/handle-webhook.ts",
        // NextAuth config object (adapter wiring, providers, the
        // events.signIn guest-order-claiming callback) -- same rationale as
        // lib/admin-auth/config.ts above; needs a real Google OAuth round
        // trip and database to exercise meaningfully, not a unit test.
        "lib/customer-auth/config.ts",
        // Prisma CRUD (same rationale as lib/cart/cart.ts above).
        "lib/customer/addresses.ts",
        // "use server" mutations -- thin wrappers (auth check, validate
        // FormData, delegate, revalidatePath); same rationale as
        // lib/cart/actions.ts above.
        "lib/customer/actions.ts",
        // Prisma + AliExpress-client orchestration (same rationale as
        // lib/orders/create-order.ts above) -- needs a real database and
        // (for a true end-to-end check) the AliExpress gateway; exercised
        // against ALIEXPRESS_MODE=fixture manually, see docs/decisions.md.
        "lib/orders/place-supplier-order.ts",
        "lib/orders/sync-tracking.ts",
        // Thin BullMQ/ioredis wrappers -- nothing to unit test without a
        // real Redis connection; exercised by the worker running against
        // a real queue.
        "lib/queue/connection.ts",
        "lib/queue/fulfilment-queue.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
