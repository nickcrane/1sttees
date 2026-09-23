# Deployment: Railway + GitHub Actions

Two Railway environments (`test`, `production`), each running two services
(`web`, `worker`) plus its own Postgres and Redis. GitHub Actions is the only
thing that deploys -- Railway never watches the repo directly -- so the
pipeline logic lives in version control, not split across two dashboards.

```
push to main
  -> CI (quality-gates.yml): typecheck, lint, unit tests, build, e2e
  -> on success: Deploy to test (automatic)
       -> railway up  --service web    --environment test
       -> railway up  --service worker --environment test

you, deliberately, from the Actions tab
  -> Deploy to live (workflow_dispatch, pick a ref)
       -> quality-gates.yml re-run against that exact ref
       -> GitHub Environment approval gate (if configured -- see below)
       -> railway up  --service web    --environment production
       -> railway up  --service worker --environment production
```

Nothing reaches `production` except through that manual trigger. `test` and
`production` are fully separate Railway environments with their own Postgres,
Redis, and environment variables -- no data or secrets are shared between
them.

## Why Railway

See [decisions.md](decisions.md) -- chosen over Vercel/GCP because the
BullMQ worker needs a genuinely persistent process (not scale-to-zero), the
client already operates Postgres/Redis/cron for a sibling project on
Railway, and Railway's Environments feature maps directly onto the test/live
split this pipeline needs.

**Note on Railway's own config-as-code:** `railway.json`/`railway.toml`
(Config as Code) is deprecated and stops being read on **2026-12-01**, in
favour of a newer Infrastructure-as-Code format (`.railway/railway.ts`).
Because of that imminent cutoff, this repo deliberately does **not** commit a
`railway.json` -- service configuration (build/start commands, env vars) is
set directly in the Railway dashboard per service instead, which stays
correct regardless of which config-as-code format is current. Worth
revisiting once IaC has settled, to get the setup below fully into version
control.

## One-time Railway setup (dashboard)

Do this once per environment (`test`, then `production`):

1. **Environment.** In the existing 1st Tees Railway project, create an
   environment named `test` and one named `production` (Project Settings ->
   Environments), if they don't already exist.
2. **Postgres + Redis.** In each environment, add a Postgres plugin and a
   Redis plugin (`+ New` -> Database). Each environment gets its own --
   don't point both at the same database.
3. **Two services, both as "Empty Service" (not GitHub-connected).**
   Deliberately *not* connecting these to the GitHub repo directly --
   GitHub Actions' `railway up` is the only deploy trigger, so there's one
   place the pipeline logic lives, not two systems that could race. Create:
   - `web`
   - `worker`

   in each environment (four services total across both environments).
4. **Start commands.** Per service, in Settings -> Deploy:
   - `web`: `pnpm exec prisma migrate deploy && pnpm start`
     (migrations run on every boot -- Prisma's `migrate deploy` is designed
     to be safe to re-run and safe under concurrent execution, so this
     stays correct even if `web` is ever scaled to multiple replicas. It
     also means a broken migration fails the deploy loudly instead of
     shipping app code that expects a schema that isn't there.)
   - `worker`: `pnpm worker`
   - Build command for `web`: leave on Railpack's default (it runs
     `pnpm build` = `next build` automatically).
   - Build command for `worker`: override to
     `echo "no build needed -- worker runs via tsx"` (Settings -> Build ->
     Custom Build Command). Confirmed live: Railpack otherwise runs the
     *full* `pnpm build` for every service that shares this repo/package.json,
     regardless of whether that service's start command actually needs the
     Next.js build output. `worker` runs via `tsx` directly and never reads
     `.next/`, so the real build wastes 3-4 minutes and -- worse -- fails,
     since `next build`'s page-data collection pulls in `lib/env.ts` and
     demands `web`-only secrets (`CART_COOKIE_SECRET`, a valid `SENTRY_DSN`)
     that `worker` has no reason to hold.
5. **Environment variables.** Per service, set every var from
   [.env.example](../.env.example) that the app actually needs at runtime.
   Reference `DATABASE_URL`/`REDIS_URL` from the Postgres/Redis plugins you
   added (Railway exposes these as variables you can reference with
   `${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}` rather than
   copy-pasting). The fields below **must differ** between `test` and
   `production` -- never reuse a live credential in `test`:

   | Variable | `test` | `production` |
   |---|---|---|
   | `NODE_ENV` | `production` (this is a Node runtime-mode flag, not a Railway-environment name -- Railway's own `test`/`production` environments are separate from it) | `production` |
   | `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe **test-mode** keys | Stripe **live** keys |
   | `PAYPAL_ENV` | `sandbox` | `live` |
   | `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_WEBHOOK_ID` | Sandbox app credentials | Live app credentials |
   | `ALIEXPRESS_MODE` | `fixture` (confirmed decision -- test never places a real supplier order) | `live` |
   | `STORE_BASE_URL` | the Railway-assigned `test` domain (or a custom staging subdomain) | the real production domain |
   | `ADMIN_EMAILS` | your email (so you can actually sign in to test) | your email |
   | `AUTH_SECRET` / `CUSTOMER_AUTH_SECRET` / `ADMIN_AUTH_SECRET` / `CART_COOKIE_SECRET` / `TOKEN_ENCRYPTION_KEY` | generate separately per environment (`openssl rand -base64 32`) | generate separately, never reused from test |
   | Everything else in `.env.example` | same value is fine | same value is fine |

   `worker` needs the same AliExpress/Stripe/PayPal/pricing vars as `web` (it
   places supplier orders and reads pricing config). It does **not** use
   the cart/auth secrets at runtime, but it still needs `CART_COOKIE_SECRET`
   set to *some* valid string -- confirmed live: `lib/env.ts` validates its
   entire schema up front on import (by design, see the comment in that
   file), and `worker`'s own entrypoint pulls it in transitively via
   `lib/queue/connection.ts`, so a missing `CART_COOKIE_SECRET` crash-loops
   the worker container even though it never sets a cart cookie. Give
   `worker` its own generated value (`openssl rand -base64 32`), same as
   the other auth secrets -- don't reuse `web`'s.

   **Any `CHANGE_ME` placeholder in a `z.url().optional()` field
   (`SENTRY_DSN`, `ALIEXPRESS_CALLBACK_URL`) breaks the build**, not just
   at runtime -- confirmed live, twice. Zod's `.optional()` only skips
   validation for a truly *absent* value; `stripBlankValues()` in
   `lib/env.ts` only strips genuinely empty strings, so a present-but-not-
   a-URL placeholder like `CHANGE_ME` still fails `.url()` and fails the
   whole `next build` (these fields are read during Next.js's static
   page-data collection for several routes). Until you have the real
   value, use a syntactically valid placeholder instead, e.g.
   `https://sentry.invalid/not-configured-yet` -- not the literal string
   `CHANGE_ME`.

   **`package.json` pins `"packageManager": "pnpm@<version>"`**, and this
   is load-bearing for Railway specifically, not just a nicety -- confirmed
   live: without it, Railpack guessed pnpm 9.15.9 against a lockfile
   written by pnpm 12, and `pnpm install --frozen-lockfile` failed with
   `packages field missing or empty`. `packageManager` is the single
   source of truth both CI and Railway read the version from; don't also
   pass a `version:` input to `pnpm/action-setup@v4` in the workflows --
   specifying it in both places is a hard error (the action refuses to
   guess which one wins).

   **Next.js prerenders metadata routes (`sitemap.ts`, and any page
   without `generateStaticParams`) at build time by default** -- fine on
   GitHub Actions, where `quality-gates.yml`'s Postgres/Redis service
   containers give the build a real database to query, but Railway's
   build runs in an isolated builder container with no access to the
   private network. Confirmed live: `app/sitemap.ts`'s build-time
   `prisma.product.findMany()` failed every Railway build with `Can't
   reach database server at postgres.railway.internal:5432`. Fixed with
   `export const dynamic = "force-dynamic"` on that route, which also
   happens to be more correct than a build-time snapshot for a catalog
   that changes over time. Any future route that queries the DB and isn't
   already opted into dynamic rendering (via auth/cookies/etc.) needs the
   same treatment.

## One-time GitHub setup

1. **Railway Project Tokens.** In the Railway dashboard, Project Settings ->
   Tokens, create two tokens: one scoped to the `test` environment, one
   scoped to `production`. (Project Tokens are scoped to a single
   project+environment -- the `test` token genuinely cannot deploy to
   `production`, which is the point.)
2. **Repo secrets.** In the GitHub repo, Settings -> Secrets and variables ->
   Actions, add:
   - `RAILWAY_TOKEN_TEST` -- the test-scoped token
   - `RAILWAY_TOKEN_LIVE` -- the production-scoped token
3. **GitHub Environments (the approval gate).** Settings -> Environments,
   create two: `test` and `live` (these names match the `environment:` keys
   in `deploy-test.yml`/`deploy-live.yml`). On `live`, add yourself as a
   **required reviewer**. This means running "Deploy to live" from the
   Actions tab pauses and waits for you to click Approve before it touches
   Railway -- a second, GitHub-native confirmation on top of the
   workflow_dispatch trigger itself. Leave `test` with no required
   reviewers so it stays automatic.

## Day to day

- **Push to `main`:** CI runs. If it passes, `test` deploys automatically --
  nothing to do.
- **Go live:** GitHub -> Actions tab -> "Deploy to live" -> Run workflow ->
  enter the ref (defaults to `main`) -> Run. This re-runs the full quality
  gate suite against that exact commit (not whatever already ran on `main`
  -- see the workflow's own comment for why), then waits for your approval
  if the `live` Environment reviewer is configured, then deploys.

## Rollback

Railway keeps a deploy history per service. Fastest rollback: Railway
dashboard -> the service -> Deployments -> pick a previous successful
deploy -> Redeploy. Equivalent from this pipeline: re-run "Deploy to live"
with the `ref` of the last-known-good commit/tag.

## Custom domains

Registrar is GoDaddy (`1sttees.golf`). Both domains are on the `web`
service's Custom Domain setting (Settings -> Networking), one per
environment:

- `test`: `test.1sttees.golf` -- ordinary subdomain, works as a plain
  CNAME (+ Railway's verification TXT record).
- `production`: **not** the bare `1sttees.golf` apex -- see below.

**GoDaddy (like most registrars) won't allow a `CNAME` at the root/apex
domain**, confirmed live (`1sttees.golf` -> "Invalid name added" in
GoDaddy's DNS UI). This is a DNS-standard restriction (CNAME can't
coexist with the NS/SOA records that must exist at the apex), not a
GoDaddy bug, so it'll bite on any registrar without ALIAS/ANAME/CNAME-
flattening support. Worked around by pointing `www.1sttees.golf` at
Railway instead (an ordinary subdomain, no restriction) and using
GoDaddy's **Domain Forwarding** feature to 301-redirect the bare
`1sttees.golf` -> `https://www.1sttees.golf` (plain redirect, not
"masked" -- masked forwarding keeps the apex in the address bar behind
an iframe, which breaks TLS and looks broken to browsers). The
alternative -- moving DNS hosting to Cloudflare for its apex CNAME-
flattening -- was considered and declined for now: it adds a vendor and
a slower nameserver-level propagation for a one-domain project at this
scale; revisit if a second domain or stricter apex requirements show up.

Per domain, Railway's "Add Custom Domain" flow generates two DNS
records to add at the registrar: a `CNAME` (the domain/subdomain name
-> a Railway-assigned `*.up.railway.app` target) and a `TXT` record
(`_railway-verify[.subdomain]` -> a verification token) that Railway
polls for before issuing a TLS certificate and marking the domain
active. Verification isn't instant even once DNS has propagated --
Railway checks on its own interval (took several minutes in practice) --
so don't assume a domain is broken just because it still shows "Waiting
for DNS update" right after adding the records.

## Verified live

Confirmed end-to-end against this actual pipeline, not just that the
YAML validates: a real push to `main` running the full CI suite,
auto-deploying to `test`, and both `web` and `worker` reaching a
genuinely healthy running state (checked Railway's own Deploy Logs, not
just GitHub Actions' "success" -- that only reflects that `railway up`
was invoked, not that Railway's build/deploy actually succeeded). Also
ran a full "Deploy to live" promotion through the required-reviewer
approval gate to `production`, with the same healthy-service
verification, plus both custom domains resolving with valid
Railway-issued TLS certificates and the apex redirect working. The
`railway` CLI flags in the workflows (`--service`, `--environment`,
`--detach`, `RAILWAY_TOKEN`) are confirmed correct as of this pipeline's
first real runs -- update the two `railway up` lines in
`deploy-test.yml`/`deploy-live.yml` if a future Railway CLI version
changes them.
