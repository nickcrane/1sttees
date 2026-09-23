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
   - Build command for both: `pnpm build` (Railway's default Node/pnpm
     detection via Railpack should pick this up automatically; set it
     explicitly if it doesn't).
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
   places supplier orders and reads pricing config); it doesn't need the
   auth secrets.

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

## Before relying on this for real

The exact `railway` CLI flags above (`--service`, `--environment`,
`--detach`, the `RAILWAY_TOKEN` env var) come from Railway's current CLI
docs, cross-checked but not run against a live project by this session --
CLI syntax has changed across Railway versions before. The first time you
run `pnpm dlx @railway/cli up --help` (or let the workflow run and watch it
fail if something's off), confirm the flags still match; update the two
`railway up` lines in `deploy-test.yml`/`deploy-live.yml` if not.
