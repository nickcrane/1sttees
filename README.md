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

## Catalog pipeline

Four stages: discover via the AliExpress DS API, classify/normalise via a
structured-output Claude call, admin curation (Candidates/Review/Catalogue),
then a second Claude pass writes the storefront listing. Full design in
[docs/product-flow.md](docs/product-flow.md).

**Reject feedback loop.** Clicking Reject in Candidates or Review queue
asks for no explanation. Instead, every classify run
(`classifyDiscoveredProducts()` in `lib/catalog/classify.ts`) pulls recent
REJECTED products' own metadata -- title, the classifier's own past
material guess, the supplier's raw `sku_attrs` -- via
`lib/catalog/reject-feedback.ts`, and uses it two ways:

- Up to 8 of them are appended to the classifier's system prompt as
  few-shot examples, with this instruction: *"An admin rejected each of
  these real products (no written reason given -- use your own judgment
  on what they have in common and why they weren't suitable)."* The model
  gets the same kind of raw data it already reasons over for every other
  product, tagged as rejected, and draws its own conclusions rather than
  being handed a canned rule.
- Separately, title words that appear in >= 2 rejected titles and zero
  accepted ones are mined as `flaggedTerms`. If a new product's title
  matches one, an otherwise-CANDIDATE decision is downgraded to REVIEW
  (never straight to REJECTED) with a note explaining why -- a cheap,
  fast-path second opinion on top of the LLM call, not a replacement for
  an admin's final say.

REJECTED only ever happens via an explicit admin action -- the classifier
itself routes to CANDIDATE or REVIEW, never REJECTED
(`lib/catalog/classify-decision.ts`) -- so every example fed back is
genuine admin signal, not the model reinforcing its own earlier guess.

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
