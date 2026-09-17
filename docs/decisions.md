# Decisions

Dependency justifications (one line each, per project rule) and any other
choice made during scaffolding that isn't obvious from the diff.

## Dependencies

- **Next.js 15.5.25** — pinned per spec; latest 15.x, avoids the just-released
  Next 16 line the spec didn't ask for.
- **Prisma 6.19.3, not 7.x/8.x** — Prisma 7 removed `datasource { url = env(...) }`
  support from `schema.prisma` in favour of a `prisma.config.ts` + driver-adapter
  model (confirmed by hitting `P1012` during scaffolding); 8.0 is still an RC.
  6.19.3 is the last version using the classic, widely-documented
  schema-based config every Prisma+Next.js tutorial assumes — more boring,
  more stable target for a production store. Revisit once 7's config model
  has matured and has more third-party documentation.
- **shadcn/ui (`base-nova` style, neutral base color)** — spec-pinned
  component layer; defaults accepted at init, easy to reskin later.
- **Zod 4** — spec-pinned for all boundary validation (env, API responses,
  form input).
- **Vitest 5 + @vitejs/plugin-react + jsdom + @testing-library/react** —
  spec-pinned unit/integration test stack; jsdom needed for any component
  tests, `@testing-library/jest-dom` for the DOM matchers.
- **@vitest/coverage-v8** — v8's native coverage instrumentation, no source
  transform step, needed to enforce the spec's 80%-on-`/lib` gate.
- **Playwright** — spec-pinned e2e stack.
- **tsx** — runs `prisma/seed.ts` (and later, `/worker`) directly from
  TypeScript without a separate compile step.
- **pino** — spec-pinned structured logger.
- **husky** — smallest standard way to wire a git `pre-commit` hook that
  every clone gets automatically via `pnpm install`'s `prepare` script.
- **gitleaks** (Homebrew binary + `gitleaks/gitleaks-action` in CI, not an
  npm package) — industry-standard secret scanner, satisfies the "no
  committed secrets" rule locally (pre-commit) and again in CI. Not
  installed as a devDependency because it's a Go binary, not JS; the
  pre-commit hook warns (doesn't block) if it's missing locally so a
  contributor without Homebrew isn't hard-blocked from committing, but CI
  always runs it, so nothing unscanned reaches `main`.
- **dotenv** — Next.js loads `.env` on its own, but plain `tsx` entrypoints
  (the AliExpress CLI scripts, `prisma/seed.ts`) don't; confirmed by hitting
  a real "DATABASE_URL: undefined" crash running `pnpm ae:product` before
  adding this. One explicit `loadDotenv({ quiet: true })` at the top of
  `lib/env.ts` fixes every entrypoint at once rather than special-casing each
  script; harmless under Next.js since dotenv never overwrites an
  already-set value.
- **pino-pretty** — human-readable dev-mode log formatting for `pino`
  (spec-pinned); only loaded when `NODE_ENV=development`.

## Phase 1 (AliExpress client) decisions

- **MD5 signing (the classic "secret-wrap" scheme), not the platform's
  documented HMAC-SHA256** — see `docs/aliexpress-api-notes.md`'s "Signing
  algorithm" section. Chosen because it's the one with an actual working
  reference implementation (`python-aliexpress-api`, run live daily by the
  sibling aliexpress-dashboard project) to port and cross-check test vectors
  against, not just docs pseudocode with no worked example.
- **`AliExpressClient` takes an injectable `TokenStore`** (defaults to a
  real Postgres-backed one) rather than calling Prisma directly. Lets the
  OAuth-flow tests (`exchangeCodeForToken`, `refreshAccessToken`) run against
  an in-memory double, keeping the whole `tests/unit/aliexpress/*` suite
  free of any database dependency — consistent with the project rule that
  the test suite must run offline and deterministically.
- **`lib/aliexpress/prismaTokenStore.ts` split out from `tokens.ts` and
  excluded from the coverage gate**, same rationale as `lib/prisma.ts` in
  Phase 0: it's a thin Prisma wrapper around already-unit-tested logic
  (`resolveTokenToPersist`, `encryptSecret`/`decryptSecret`); the DB
  round-trip itself was verified manually against a real Postgres instance
  (`pnpm ae:authorize --code ...`, confirmed the row landed encrypted) rather
  than in the unit suite.
- **Per-SKU fields on `aliexpress.ds.product.get`'s response
  (`sku_id`, `sku_attr`) are provisional**, not yet confirmed by any live
  call this project has made — modeled from what `aliexpress.ds.order.create`'s
  own docs imply about `sku_attr`'s shape. Flagged in `schemas.ts`'s comments
  and `docs/aliexpress-api-notes.md`'s "Open items"; re-check against a real
  response once the new AliExpress app exists.
- **Reversed: reusing aliexpress-dashboard's AliExpress app, not a new
  dedicated one (2026-09-17).** The original plan (a fresh app, to keep a
  research tool's blast radius separate from something placing real orders)
  hit a real platform constraint: AliExpress caps the
  Drop Shipping permission group to **one app per developer account** —
  confirmed live, "Reach Limit" shown when trying to grant Drop Shipping to
  a second app on the same account aliexpress-dashboard's app already uses.
  The options were a second AliExpress account (its own buyer identity, its
  own DS Center agreement) or reusing the existing app; the client chose to
  reuse it. `ALIEXPRESS_APP_KEY`/`ALIEXPRESS_APP_SECRET` in `.env` are now
  the same values as `aliexpress-dashboard/.env`'s `AE_APP_KEY`/`AE_APP_SECRET`.
  Consequence worth watching: both projects can call the API under the same
  app identity, but each runs its own independent OAuth authorization (its
  own `pnpm ae:authorize` / that project's `authorize` CLI), so each holds
  its own access/refresh token pair — unconfirmed whether AliExpress allows
  two live, independently-refreshed token pairs for the same (app, user)
  at once, or whether one authorizing/refreshing can affect the other's
  token. Watch for unexplained `IllegalRefreshToken`-type errors in either
  project as a sign this assumption is wrong.

## Architecture decisions (confirmed with the client, 2026-09-17)

- **Auth: Auth.js + our own Postgres tables, not Firebase Auth.** Firebase
  Auth was considered (already used for login in the sibling
  `aliexpress-dashboard` project's `web-m3` dashboard) but rejected for this
  project specifically because it can't meet several requirements the spec
  states as non-negotiable: it hashes passwords with its own internal
  scrypt, not a chosen algorithm, so the spec's "argon2id, never
  bcrypt-with-defaults" can't be honoured; it has no webhook/trigger for a
  plain sign-in event on the free tier (would need paid GCP Identity
  Platform blocking functions), so a complete `SecurityEvent` audit trail
  can't be built on top of it without extra infrastructure; and true
  customer/admin realm isolation would rely on custom claims rather than
  two genuinely separate session stores. Auth.js against `Customer`/
  `PasswordResetToken`/`CustomerSession` (already in the domain model)
  hits every one of these as specified, at the cost of owning more code.
- **Hosting: Railway for both the Next.js web app and the BullMQ worker in
  production — not the spec's original Vercel (web) + Railway (worker)
  split, and not Firebase Hosting/App Hosting.** Firebase was ruled out
  because it has no product that runs a persistent Node process (the
  worker would need GCP Cloud Run regardless, new territory), so it
  wouldn't actually reduce the number of platforms in play. Vercel was
  dropped in favour of running the Next.js app on Railway too (`next
  start` as a plain long-running process, not Vercel's edge/serverless
  model) so the whole stack sits on one platform the client already
  operates in production (aliexpress-dashboard's Postgres, Redis, volumes,
  and cron patterns on Railway carry over directly). Trade-off: loses
  Vercel's zero-config preview deployments, edge network, and built-in ISR
  handling — acceptable for a single-region UK/EU store.

## Other Phase 0 decisions

- **No `/src` directory.** The spec's REPO SHAPE lists `/app`, `/lib`,
  `/worker` etc. at the repo root; `create-next-app`'s `--src-dir` default
  puts them under `/src` instead. Moved everything up a level and pointed
  `tsconfig.json`'s `@/*` alias and `components.json` at the new paths to
  match the spec exactly.
- **`lib/env.ts` validates the full env surface, but only requires what's
  built so far.** The spec's CONFIG section lists ~30 env vars spanning
  every phase. All of them are documented in `.env.example` now (so the
  full configuration surface is visible from day one), but `lib/env.ts`
  only makes `DATABASE_URL`/`REDIS_URL` required today — everything else is
  `.optional()` until the phase that actually reads it tightens its
  schema entry to required. Otherwise Phase 0's "hello store" would need
  Stripe/PayPal/AliExpress/Resend credentials just to boot.
- **Docker wasn't available on the machine this was scaffolded on.**
  `docker-compose.yml` (Postgres 16 + Redis 7) is written and is the
  intended local-dev path per spec, but couldn't be exercised here.
  Verified the equivalent locally instead: Postgres 16 and Redis installed
  via Homebrew, run as ephemeral (non-`brew services`) processes for the
  duration of scaffolding, migrated/seeded/queried successfully, then
  stopped. Before trusting `docker compose up` itself, install Docker
  Desktop (or another compatible runtime) and run it once.
- **Coverage gate scoped to `lib/**`, excluding `lib/prisma.ts`.** The spec
  says "minimum coverage 80% on `/lib`"; `lib/prisma.ts` is a two-line
  singleton wrapper with no branching logic, more honestly exercised by
  integration/e2e tests against a real database than by a unit test that
  would just mock Prisma to prove the mock works.
