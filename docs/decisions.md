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
- ~~Per-SKU fields on `aliexpress.ds.product.get`'s response are
  provisional~~ — **confirmed live 2026-09-17** against real bamboo golf
  tee listings (`sku_attr` values like `"14:10#100pcs 83mm"`). Also found
  and fixed two real bugs this way: the endpoint-URL shape the official
  docs describe for auth calls doesn't match what the gateway actually
  accepts (`IncompleteSignature`, fixed to match `python-aliexpress-api`'s
  proven request construction exactly), and `text.search`'s `products` /
  `product.get`'s SKU and video lists all arrive wrapped in a single-key
  object rather than as a bare array (ported aliexpress-dashboard's
  `extract_list` fix as `schemas.ts`'s `extractList`/`extractValidItems`).
  See `docs/aliexpress-api-notes.md` for the full detail.
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

## Phase 2 (data model, pricing engine, import pipeline, admin auth)

### Dependencies

- **next-auth@5 beta (Auth.js), not the "latest"-tagged v4.** The spec
  names "Auth.js (NextAuth)" specifically — Auth.js is the v5 rebrand, and
  v5 is edge-middleware-native in a way v4's App Router support (bolted on
  later) isn't. The beta label is misleading here: it's been the de facto
  standard for new Next.js App Router projects for a long time, with far
  more current documentation/community usage than pinning v4 would buy in
  exchange for a "stable" tag.
- **argon2**, not bcrypt — the spec is explicit ("argon2id, never
  bcrypt-with-defaults") for customer auth; applied the same standard to
  admin auth for one consistent security posture rather than two.
- **otpauth** — RFC 6238 TOTP, no legacy baggage, the library
  `docs/aliexpress-api-notes.md`'s own TOTP code already depended on
  conceptually (this is its first real use: admin 2FA).
- **qrcode** — server-side QR code generation for TOTP enrollment; avoids
  a client-side QR library and keeps the raw secret server-only until it's
  rendered into an image.
- **ioredis** — the spec already pins Redis for BullMQ (Phase 4); brought
  forward now for admin auth's rate-limiting/lockout counters rather than
  inventing a separate mechanism, and it's the client BullMQ itself expects.

### Real bugs found running this against an actual browser, not just tests

All four below were invisible to `pnpm build`/unit tests and only surfaced
running a real sign-in through the browser — worth internalizing as a
pattern: Edge Runtime and cookie behavior specifically need a live check,
not just a green build.

- **Edge Runtime can't bundle Node built-ins, and this bites twice.**
  `middleware.ts` runs in the Edge runtime by default. (1) The full admin
  auth config (argon2, ioredis, `node:crypto` via `lib/crypto.ts`) can't be
  bundled there at all -- fixed by splitting `lib/admin-auth/edge-config.ts`
  (Edge-safe, no providers, used only by middleware) from
  `lib/admin-auth/config.ts` (the full config, Node-only, used everywhere
  else) -- the standard Auth.js pattern for exactly this problem. (2)
  `lib/env.ts`'s `dotenv.config()` call uses `process.cwd()` internally,
  which Edge also disallows -- `edge-config.ts` reads `process.env`
  directly instead of importing `@/lib/env`, since Next.js already
  populates `process.env` for Edge middleware without needing dotenv at all.
- **`pino-pretty`'s worker-thread transport (via `thread-stream`) doesn't
  survive webpack bundling in Next.js API routes** -- `Cannot find module
  '.../vendor-chunks/lib/worker.js'`, which crashed the entire dev server
  on the very first sign-in attempt (not a request-scoped error -- an
  uncaught exception that killed the process). First suspected argon2
  (same worker-thread pattern, same symptom class) and excluded it too
  from bundling via `serverExternalPackages` in `next.config.ts`
  preemptively -- turned out to be pino-pretty, but argon2 was excluded on
  correct suspicion anyway.
- **A `__Host-` prefixed cookie requires `Secure: true`, or the browser
  silently refuses to set it at all -- no error, nothing in server logs.**
  The admin session cookie was hardcoded to `__Host-admin-session`
  unconditionally; in dev (plain `http://localhost`, `secure: false`)
  every sign-in "succeeded" server-side (`authorize()` returned a user, a
  JWT was issued) but the browser never stored the cookie, so the very
  next request looked signed-out again -- looked exactly like an
  authentication failure and cost real debugging time to trace to the
  cookie layer instead. Fixed by only using the `__Host-`/`Secure`
  combination in production, a plain cookie name otherwise -- matches
  NextAuth's own default convention, which this custom cookie config had
  deviated from without realizing why that convention exists.
- **`prisma migrate dev`/`reset` are non-interactive-hostile, and Prisma
  itself now hard-blocks an AI agent from running `migrate reset` without
  the user's own explicit, message-quoted consent.** Ran into this
  cleanly (asked, got a clear "yes, go ahead", proceeded with
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set to that exact text) --
  noted here as confirmation the guardrail works as intended, not as a bug.

## Phase 3 (storefront, cart, checkout, payments)

### Real bugs found running a live Stripe test-mode checkout

- **`payment_intent.payment_failed` is not a terminal Stripe event, and
  treating it as one broke a real checkout.** The webhook handler
  originally mapped `payment_intent.payment_failed` straight to the order
  lifecycle's `CANCELLED` state. Confirmed live: abandoning a 3DS
  challenge on Stripe's test card (`4000 0027 6000 3184`) fires
  `payment_intent.payment_failed` for that attempt, but the *same*
  PaymentIntent (same `clientSecret`, same Payment Element on the page)
  can still be retried with a different card and succeed -- which is
  exactly what happened: the retry with `4242 4242 4242 4242` succeeded on
  Stripe's side and fired `payment_intent.succeeded`, but the order was
  already `CANCELLED` from the first event, so `applyPaymentEvent`'s own
  `PENDING_PAYMENT`-only guard (correctly) ignored the real success and
  left a paid order stuck cancelled. Fixed by listening for
  `payment_intent.canceled` instead (Stripe's actual "this intent is dead"
  signal) and letting `payment_intent.payment_failed` fall through to
  "other" (still recorded via `WebhookEvent` for audit, just not
  state-changing) -- see `lib/payments/stripe.ts`. A truly abandoned
  `PENDING_PAYMENT` order (customer never returns at all) is left for a
  Phase 4 expiry/cleanup job, not this webhook.

### Verified live, Stripe test mode

- A full checkout with `4242 4242 4242 4242` (no 3DS required) end to end:
  order created with server-recomputed totals, `payment_intent.succeeded`
  webhook received and verified (signature via the Stripe CLI's
  `stripe listen` forwarding), order flipped to `PAID` with the correct
  card brand/last4, cart cleared, confirmation page rendered correctly.
- The SCA challenge itself: `4000 0027 6000 3184` correctly triggers
  Stripe's 3D Secure 2 interstitial (right business name, right context)
  via `stripe.confirmPayment`'s `automatic_payment_methods` handling --
  confirming our integration correctly hands the challenge off to Stripe.
  Completing Stripe's own test-mode 3DS interstitial itself (a
  doubly-nested cross-origin iframe) hit a browser-automation tooling
  limit in this environment and couldn't be clicked/keyboard-activated
  through; the non-3DS path above exercises the identical
  confirm→webhook→PAID→confirmation code path a completed 3DS payment
  would also go through. Worth a manual click-through in a real browser
  before shipping, since the interstitial itself was never actually
  dismissed successfully end to end.
- PayPal sandbox is still unverified -- `PAYPAL_CLIENT_ID`/
  `PAYPAL_CLIENT_SECRET`/`PAYPAL_WEBHOOK_ID` aren't in `.env` yet.

### Lighthouse (spec: "Lighthouse ≥90")

Ran `npx lighthouse` against a production build (`pnpm build && pnpm start`)
for `/`, `/products`, and a product detail page. All four categories score
≥90 on every page (mostly 96-100); the one dip to 96 on best-practices is
solely the known fixture-data image 404 (`ae01.alicdn.com/kf/bamboo-tee-*
.jpg` isn't a real, resolvable AliExpress CDN URL -- it's fixture-mode
import test data), not an application defect -- it'll resolve once real
imported product images are in place. Not wired into CI (no Chrome
available there without extra setup); re-run manually before each
release-worthy checkpoint instead.

## Phase 3.5 (customer accounts)

### Real bugs found running a live Google sign-in

- **Auth.js's OAuth flow hard-codes `emailVerified: null` on user
  creation, regardless of what a provider's `profile()` callback
  returns.** Read `@auth/core`'s `handle-login.js` directly to confirm:
  `createUser({ ...profile, emailVerified: null })` -- it spreads the
  `profile()` return first, then explicitly overwrites `emailVerified`
  back to `null` immediately after, a deliberate "don't trust any OAuth
  provider's claim by default" choice (its own comment explains why:
  providers don't always require email verification in practice). First
  attempt was a custom `profile()` callback mapping Google's
  `email_verified` claim -- confirmed live via a real sign-in that this
  has no effect, `User.emailVerified` stayed `null` in Postgres despite
  Google having verified the email as part of the OAuth handshake itself.
  Fixed by moving the mapping into `events.signIn` (`account?.provider ===
  "google" && profile?.email_verified` -> update the row), which runs
  *after* Auth.js's internal creation logic. This isn't cosmetic: the
  guest-order-claiming feature (linking a guest `Order.email` to the
  signed-in account) trusts `user.email`, and an honest `emailVerified`
  flag is what makes that trust well-founded rather than accidental.
- The Google Cloud Console OAuth client's secret was retyped/copied
  incorrectly the first time -- Google's token exchange failed with
  `invalid_client: The provided client secret is invalid`, surfaced to
  the browser as a generic "Server error / problem with the server
  configuration" with the real reason only in the server logs. Fixed by
  re-copying the secret from the Console; worth remembering as the first
  thing to check for that generic error message.

### Verified live

- A real Google sign-in end to end: OAuth redirect to Google's real
  consent screen (no `redirect_uri_mismatch`/`invalid_client`), successful
  callback, `User`/`Account`/`Session` rows created correctly,
  `emailVerified` set (after the fix above). Two guest orders placed
  under the same email were correctly linked (`Order.customerId` set) on
  sign-in. Nick separately confirmed the order-history and addresses
  pages render correctly live too.

## Phase 4 (fulfilment automation)

**Dependencies:** `bullmq` -- the spec's own stack pin ("BullMQ + Redis
for background jobs"); a dedicated `ioredis` connection
(`lib/queue/connection.ts`), separate from `lib/redis.ts`'s
general-purpose client, since BullMQ's Worker holds blocking commands
open and shouldn't share a connection with unrelated rate-limiting code.

**Design:** `lib/orders/confirm-payment.ts`'s `markOrderPaid` enqueues a
`place-supplier-order` job (fire-and-forget -- the webhook/return-page
response shouldn't block on a slow external API call) rather than calling
AliExpress synchronously. `worker/index.ts` is the separate long-running
consumer the spec calls for (`pnpm worker`), processing that queue plus a
repeatable `sync-tracking` job every 4 hours. `tryToPay` stays `false` --
the auto-pay whitelist still isn't confirmed (see the Phase 1 notes in
[[aliexpress_ds_api_confirmed_facts]]), so `SUPPLIER_ORDER_PLACED` means
"placed with the supplier", not "paid to the supplier"; a human still has
to pay it manually on AliExpress, which is why `/admin/orders` surfaces
those orders explicitly under "needs attention" alongside
`NEEDS_MANUAL_REVIEW`. "Delivered" tracking status is a best-effort
regex over `aliexpress.ds.order.tracking.get`'s free-text event
descriptions (`/delivered/i`) -- that API has no dedicated delivered
boolean/enum; `order_status` on `aliexpress.ds.order.get` is a candidate
for a more reliable signal but wasn't confirmed live against a real
shipped order as of this phase.

### Real bugs found running this against a real queue and a real build

- **BullMQ v6 rejects a colon in a custom Job Id** (`Error: Custom Id
  cannot contain :`) -- confirmed live enqueuing a real job with
  `place-supplier-order:${orderId}` as the id, a convention several older
  BullMQ examples use. Fixed by switching to `-` as the separator
  (`place-supplier-order-${orderId}`). Doesn't apply to BullMQ's own
  auto-generated ids (e.g. its `repeat:sync-tracking:...` naming for
  scheduled jobs) -- only to ids a caller supplies explicitly via the
  `jobId` option.
- **`bullmq`'s webpack bundling breaks `next build`/`next start`
  entirely**, not just at the one call site -- confirmed live:
  `Module not found: Can't resolve '@valkey/valkey-glide'`, an optional
  alternative backend to the ioredis one this project actually uses, that
  webpack still tries to statically resolve. Same class of bug as the
  Phase 2 `pino-pretty`/worker-thread finding -- fixed the same way, via
  `serverExternalPackages` in `next.config.ts`, so `bullmq` is required
  natively by Node at runtime instead of bundled.
- BullMQ v6 moved repeatable jobs off `Queue#add`'s old `{ repeat }`
  option onto a dedicated `upsertJobScheduler(jobSchedulerId, repeatOpts)`
  API -- caught by TypeScript (`'repeat' does not exist in type
  'JobsOptions'`) before it ever ran, not a live bug, but worth noting
  since most BullMQ tutorials/examples still show the old `{ repeat }`
  form.
- `app/admin/orders/page.tsx` doesn't call `auth()` itself (middleware
  already gates `/admin/:path*`), which gave Next.js no signal to treat
  it as dynamic -- confirmed via `pnpm build`'s route table that it got
  prerendered as a **static** route (`○`), which would have served
  build-time-stale order data forever. Fixed with an explicit
  `export const dynamic = "force-dynamic"`.

### Verified live (ALIEXPRESS_MODE=fixture)

Ran the real pipeline end to end against a throwaway order built from the
actual published product's variant data: `placeSupplierOrder` correctly
moved `PAID -> SUPPLIER_ORDER_QUEUED -> SUPPLIER_ORDER_PLACED` and stored
the fixture's AliExpress order id; `syncTracking` then correctly picked
up the matching tracking fixture (keyed by that same order id) and moved
the order to `SHIPPED` with the right tracking number/carrier. Separately
verified the actual production trigger path: started `pnpm worker`,
called `enqueuePlaceSupplierOrder` for a second throwaway order, and
confirmed the worker picked the job up off a real Redis queue and
produced the identical `SUPPLIER_ORDER_PLACED` result. Not yet verified:
a real placement against the live AliExpress gateway (ALIEXPRESS_MODE=live)
under Phase 4's actual trigger path, and the "delivered" heuristic (no
delivered-status fixture exists to exercise it against).

## Design system: Material Design 3

Adopted Material 3 (color roles, elevation, shape, and type scale) as
tokens in `app/globals.css`'s `@theme`, on top of the existing shadcn/
base-ui component layer rather than swapping in an MD component library
-- the existing Button/Card/Sheet/Select components already work and are
wired through the app; re-theming them was far lower-risk than replacing
them. Brand seed is a bamboo/fairway green (~145° hue in OKLCH); M3
surfaces are subtly hue-tinted rather than pure gray, which is part of
what actually reads as "Material" rather than just rounded corners.

### Two real, previously invisible bugs found doing this

Both existed since Phase 0's scaffold -- the whole site's headings and
body text have been silently falling back to the browser's serif default
(Times) this entire time; nobody had looked closely enough at rendered
type to notice, since body copy at normal sizes doesn't look dramatically
different serif vs. sans at a glance in a screenshot taken in passing.

- **`--font-sans: var(--font-sans)` was self-referential.** next/font
  actually generates `--font-geist-sans` (`app/layout.tsx`'s
  `Geist({ variable: "--font-geist-sans" })`), not `--font-sans` -- the
  theme token was pointing at itself, which resolves to nothing.
- **Even after fixing that, `html { @apply font-sans }` still didn't
  work** -- next/font's variable is set via a class on `<body>`, not
  `<html>` (`app/layout.tsx`'s `<body className={geistSans.variable}>`).
  CSS custom properties only flow from an element to its *descendants*;
  `<html>` is `<body>`'s *ancestor*, so a rule on `html` can never see a
  variable scoped to `body`. Confirmed by walking `document.styleSheets`
  live in the browser and checking `getComputedStyle` before/after --
  the rule was present and syntactically fine, just structurally unable
  to resolve. Fixed by moving `font-sans` onto the existing `body { }`
  rule instead of a separate `html { }` one.
- **A custom Tailwind type-scale token silently ate a Button's text
  color.** `<Button className="... text-title-md text-primary-foreground ...">`
  (product page's "Add to cart") -- `text-title-md` is one of this
  project's own `@theme` font-size tokens, not a Tailwind built-in, and
  `cn()`'s tailwind-merge conflict resolution doesn't recognize it as
  distinct from a text-*color* utility. It treated `text-title-md` and
  Button's own base `text-primary-foreground` as conflicting and kept
  only one, dropping the color -- Lighthouse's color-contrast audit
  caught it (2.61 vs. the required 4.5, near-black text on the dark-green
  button). Not something a screenshot alone would obviously flag at a
  glance. Worked around by repeating `text-primary-foreground` after
  `text-title-md` in the same className so it wins the merge; the custom
  font-size still gets silently dropped in favour of Button's own default
  size, which was an acceptable trade here but worth remembering as a
  general hazard of pairing a custom `--text-*` theme token with a
  component whose variant classes already set a `text-*` color, through
  `cn()`/tailwind-merge.

## Real bug: order-confirmation page conflated "not PAID" with "not paid"

Found live: Nick placed a real Stripe test-mode order, the payment
genuinely succeeded (confirmed directly against Stripe's API -- card
charged, `paidAt`/brand/last4 all set), but the *fulfilment* step then
failed and moved the order to `NEEDS_MANUAL_REVIEW` (expected in local
dev -- `ALIEXPRESS_MODE=fixture` has no canned response for a real,
randomly-generated order number; `ALIEXPRESS_MODE=live` wouldn't hit
this). The order-confirmation page's logic was `if (status !== "PAID")
{ show "wasn't paid, no charge was made" }` -- which is simply false for
every status *after* `PAID` in the lifecycle (`SUPPLIER_ORDER_QUEUED`,
`SHIPPED`, `NEEDS_MANUAL_REVIEW`, etc. all mean the customer *was*
charged; only fulfilment had a problem). Telling a paying customer their
card wasn't charged when it was is the kind of mistake that could
plausibly make them try to pay again. Fixed by only showing the "not
paid" message for `CANCELLED` specifically (the one status
`applyPaymentEvent` actually uses for a genuine payment failure) and
treating every other non-`PENDING_PAYMENT` status as "confirmed, thanks"
-- fulfilment problems belong on `/admin/orders`, not surfaced to the
customer as a failed payment. Re-verified live against the real order
after the fix: correctly showed "Thank you for your order" with the
real item/address details.
