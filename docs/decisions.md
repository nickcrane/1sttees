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
