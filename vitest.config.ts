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
        // import.ts/pricing-rules.ts themselves are verified against a
        // real database instead of a mocked Prisma client, which wouldn't
        // exercise real upsert/unique-constraint semantics anyway.
        "lib/catalog/import.ts",
        "lib/catalog/pricing-rules.ts",
        "lib/admin-auth/config.ts",
        "lib/admin-auth/setup.ts",
        "lib/admin-auth/security-events.ts",
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
