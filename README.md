# 1st Tees

Sustainable bamboo golf tees, sold in GBP to UK/EU customers, fulfilled by
placing orders against the AliExpress Open Platform Dropshipping (DS) API.
Standalone stack — no Shopify dependency. See the mission brief in
`docs/decisions.md` and (from Phase 1 onward) `docs/aliexpress-api-notes.md`
for the design rationale.

## Stack

Next.js 15 (App Router) + TypeScript (strict) + Tailwind + shadcn/ui,
PostgreSQL + Prisma, BullMQ + Redis for background jobs, Stripe + PayPal
behind a common payment interface, Auth.js with separate customer/admin
realms, Zod at every boundary, Vitest + Playwright, Pino + Sentry.

## Quick start

```bash
cp .env.example .env        # defaults work for local Postgres/Redis
docker compose up -d        # Postgres 16 + Redis 7
pnpm install
pnpm prisma:migrate         # applies migrations, generates the client
pnpm db:seed
pnpm dev                    # http://localhost:3000
pnpm worker                 # separate terminal -- fulfilment queue consumer
```

## Quality gates

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e
```

All four (plus e2e) run in CI (`.github/workflows/ci.yml`) against Postgres
and Redis service containers, and are expected to pass before any phase of
the build is considered done.

## Deployment

Railway (`test` + `production` environments) via GitHub Actions -- push to
`main` auto-deploys to `test`; going live is always a manual, re-validated
`workflow_dispatch`. Full setup and rationale in
[docs/deployment.md](docs/deployment.md).

## Project layout

```
/app                  Next.js App Router: storefront, /account, /admin
/lib
  /aliexpress         AliExpress DS API client, signing, DTOs
  /pricing            Landed-cost + margin + VAT engine
  /cart               Signed guest-cart cookie + DB-backed cart ops
  /orders             Order creation, payment confirmation, fulfilment
  /payments           Stripe/PayPal wrappers + webhook handlers
  /customer-auth      Auth.js customer realm (Google OAuth, database sessions)
  /admin-auth         Auth.js admin realm (argon2id + mandatory TOTP)
  /queue              BullMQ queue + connection (producer side)
  env.ts              Zod-validated environment config
  prisma.ts           Shared PrismaClient singleton
/worker               BullMQ worker (pnpm worker) -- fulfilment queue consumer,
                      separate long-running process from the Next.js web app
/prisma               schema.prisma, migrations, seed.ts
/tests
  /unit               Vitest
  /e2e                Playwright
/fixtures             Recorded AliExpress + Stripe payloads for offline tests
/docs                 decisions.md, and later aliexpress-api-notes.md, runbook.md, compliance.md
```

## Secrets

Never commit `.env`. `.env.example` is the tracked template. A pre-commit
hook (`.husky/pre-commit`) runs [gitleaks](https://github.com/gitleaks/gitleaks)
if it's installed locally (`brew install gitleaks`); CI always runs it via
`gitleaks/gitleaks-action`.
