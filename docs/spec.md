MISSION

Build a production-grade, standalone e-commerce storefront ("Shopify-like", but our own stack — no Shopify dependency) that sells bamboo golf tees to UK and EU customers, with fulfilment handled automatically by placing orders against the AliExpress Open Platform Dropshipping (DS) API.

I am a UK-based sole trader / limited company operating from Cardiff, Wales. The store sells in GBP by default. Treat UK VAT and UK consumer law as hard requirements, not afterthoughts.

Work incrementally, commit at the end of each phase, and run the quality gates before declaring a phase complete. Do not skip ahead.

RULES OF ENGAGEMENT
Do not invent AliExpress API details. Before writing a single line of the AliExpress client, fetch and read the current official docs at https://openservice.aliexpress.com/ (Dropshipper / DS API section) and confirm: the gateway host, the signing algorithm, the exact method names, the request/response shapes, and the OAuth flow. Write what you confirmed into docs/aliexpress-api-notes.md with links, and build against that. If a method I name below has been renamed or removed, use the current one and tell me.
Stop and ask me if you hit: a required API permission I may not have been granted, an ambiguous business rule (pricing, returns, shipping thresholds), or anything that would cost money to test.
Never commit secrets. All credentials via .env, with a committed .env.example. Add a pre-commit secret scan.
No mock-only shortcuts in the final product, but every external call must be behind an interface with a fixture-backed test double so the test suite runs offline and deterministically.
Prefer boring, well-documented libraries over clever ones. No dependency added without a one-line justification in docs/decisions.md.
Type safety is non-negotiable: strict: true, no any, no @ts-ignore without a comment explaining why.
TECH STACK (pinned — do not substitute without asking)
Next.js 15 (App Router) + React + TypeScript (strict)
Tailwind CSS + shadcn/ui for the component layer
PostgreSQL + Prisma ORM
Stripe (Payment Intents + Stripe Elements, webhooks for fulfilment triggers) with PayPal as a second gateway behind a common interface
BullMQ + Redis for background jobs and retries (product sync, order placement, tracking polls)
Zod for all boundary validation (env, API responses, form input)
Auth.js (NextAuth) with two separate realms: customer accounts and admin accounts (see the accounts section below)
Vitest (unit/integration) + Playwright (e2e)
Resend (or Nodemailer/SMTP) for transactional email
Pino for structured logging; Sentry for error tracking
Deploy target: Vercel for the web app + a separate long-running worker process (Railway/Fly/Render). Do not assume serverless can run the queue.
REPO SHAPE
/app                  Next.js App Router (storefront + /admin)
/lib
  /aliexpress         API client, signing, DTOs, mappers, rate limiter
  /pricing            landed-cost + margin + VAT engine
  /orders             order state machine + fulfilment orchestration
  /payments           Stripe wrappers + webhook handlers
/worker               BullMQ workers (separate entrypoint, own Dockerfile)
/prisma               schema.prisma + migrations + seed
/tests                unit, integration, e2e
/fixtures             recorded AliExpress + Stripe payloads
/docs                 api-notes.md, decisions.md, runbook.md, compliance.md
DOMAIN MODEL (Prisma — refine, don't blindly copy)
SupplierProduct — AliExpress product: aeProductId, title, raw (JSONB snapshot), imageUrls[], supplierUrl, lastSyncedAt, status (ACTIVE | UNAVAILABLE | DELISTED)
SupplierVariant — aeSkuId, skuAttrs (the AliExpress sku_attr string — store it verbatim, it is required at order placement), supplierPriceMinor, currency, stock
Product / ProductVariant — our merchandised listing: our title, our copy, our images, our price, mapped 1:N to supplier variants. Merchandising must be independent of supplier data so a supplier title change never touches the storefront.
PriceRule — per product or global: cost multiplier, fixed uplift, floor margin, psychological rounding (.99), max price guard.
Customer — email (unique, citext), emailVerifiedAt, passwordHash (argon2id, nullable when they only ever use magic links), name, phone, marketingOptInAt, createdAt, deletedAt (soft delete for GDPR).
Address — belongs to Customer, type (SHIPPING | BILLING), full UK/international fields, isDefault. Addresses are copied onto orders, never referenced — editing a saved address must not rewrite the shipping address of a past order.
CustomerSession, VerificationToken, PasswordResetToken — Auth.js tables plus expiry and single-use enforcement.
Cart, CartItem — guest carts keyed by signed cookie, with a customerId that gets populated on login so a guest cart merges into the account cart rather than being lost.
Order, OrderItem — our order of record. Nullable customerId: guest orders are first-class and can be claimed later by an account with the same verified email. Money in integer minor units, never floats. Snapshot price, VAT rate and supplier cost at the moment of purchase.
SupplierOrder — the AliExpress side: aeOrderId, status, placedAt, idempotencyKey, lastError, attemptCount, linked to Order.
Shipment — trackingNumber, carrier, trackingUrl, events (JSONB), deliveredAt.
WebhookEvent — raw inbound Stripe events, deduplicated by event id.
AuditLog — every admin mutation and every automated order placement.
SyncRun — product sync job history: started, finished, counts, errors.
ALIEXPRESS INTEGRATION (/lib/aliexpress)

Build a single typed client. Requirements:

Auth: OAuth 2.0 authorisation-code flow against the AliExpress Open Platform. Store access_token + refresh_token encrypted at rest (AES-256-GCM with a key from env). Implement automatic refresh ahead of expiry with a mutex so concurrent jobs don't race. Provide an admin page showing token status and a "re-authorise" button.
Signing: implement request signing exactly as the current docs specify (expect HMAC-SHA256 over the sorted-parameter string with app_key, timestamp, sign_method, method — verify this first). Unit-test the signer against a known-good vector from the docs.
Methods to wrap (verify current names before use; these are the DS-family calls I expect to need):
product detail — aliexpress.ds.product.get
keyword/text search — aliexpress.ds.text.search
recommended feed — aliexpress.ds.recommend.feed.get
freight/shipping quote — aliexpress.ds.freight.query (or the logistics freight-calculate equivalent)
order placement — aliexpress.trade.buy.placeorder
order detail — aliexpress.ds.trade.order.get
tracking — aliexpress.ds.order.tracking.get / logistics tracking query
category and shipping-address helpers as needed
Cross-cutting concerns, all implemented once in the client:
Token-bucket rate limiter, configurable per method.
Exponential backoff with jitter; distinguish retryable (5xx, throttle, network) from terminal (invalid sku, out of stock, auth) errors via a typed AliExpressError union.
Every response parsed through a Zod schema; log and quarantine (don't crash) on schema drift, and surface a "supplier response changed" alert in admin.
Raw request/response logging to SyncRun / AuditLog with secrets redacted.
A --record mode that writes real responses into /fixtures for the test doubles.
PRICING ENGINE (/lib/pricing)

Landed cost = supplier item price + supplier shipping + payment processing (≈1.5% + 20p) + expected returns/refund reserve (configurable %) + FX buffer (configurable %, since supplier prices are typically USD).

Retail price = landed cost × margin multiplier, then rounding rule, then floor/ceiling guards.

Expose a POST /api/admin/pricing/preview endpoint and an admin table showing, per variant: supplier cost, landed cost, current retail, gross margin £ and %, and a flag when margin drops below the configured floor. When a sync pushes a variant below its floor margin, do not silently reprice — unpublish the variant and raise an admin alert.

CUSTOMER ACCOUNTS & AUTHENTICATION

Two completely separate auth realms. An admin session must never grant customer privileges or vice versa; enforce this in middleware and prove it with tests.

Customer auth

Sign-up and sign-in by email + password (argon2id, never bcrypt-with-defaults) and passwordless magic link. Email verification required before an account can see order history.
Password reset with single-use, 30-minute, hashed-at-rest tokens. Constant-time comparison. No user enumeration: sign-in, sign-up and reset must return the same timing and the same generic message whether or not the email exists.
Optional social sign-in (Google, Apple) behind a feature flag — build the Auth.js provider wiring but leave it disabled by default.
Rate limiting on every auth route (per-IP and per-email), account lockout with exponential cooldown after repeated failures, and a SecurityEvent audit trail for sign-in, sign-out, password change, email change and address change.
Sessions: httpOnly, secure, sameSite=lax cookies; rotate the session token on privilege change; "sign out of all devices" action.
Guest checkout stays available and is the default. Never force account creation to buy. Offer "create an account to track this order" on the confirmation page, pre-filled with the order's email — creating it then claims that order into the account.

Customer account area (/account)

Dashboard: most recent order with live status.
Order history: paginated list of all orders for that customer, filterable by status, each linking to a detail page with the full line items, prices, VAT breakdown, shipping address snapshot, payment method last-4, and a downloadable PDF invoice/receipt.
Order tracking: per-order timeline driven by the order state machine and Shipment events — placed, paid, preparing, dispatched, in transit, out for delivery, delivered — with carrier name, tracking number, a deep link to the carrier's tracking page, and the raw tracking event list. The same tracking view must render for guest orders via the email + order-number lookup route, so there is one component and one data path, not two.
Reorder button (re-adds the line items to the cart, re-priced at current prices with a clear notice if the price has changed).
Saved addresses: add, edit, delete, set default.
Profile: change name, phone, email (with re-verification), password.
Marketing preferences with a genuine opt-in, timestamped.
Download my data (JSON export of everything tied to the account) and delete my account (soft-delete, anonymise PII, retain the legally required order/financial records for six years — document this in docs/compliance.md).

Admin auth

Separate route group, separate session cookie, allowlisted by ADMIN_EMAILS, magic link or password plus mandatory TOTP 2FA. Admin actions all hit AuditLog with actor, IP and before/after values.
PAYMENTS (/lib/payments)

Build a PaymentProvider interface (createIntent, capture, refund, verifyWebhook, parseEvent) with two implementations so the store is never hostage to one gateway.

Stripe (primary): Payment Intents with Stripe Elements embedded in our own checkout page, so the checkout is on our domain and we control the UX. Enable card, Apple Pay, Google Pay and Link. Use 3-D Secure / SCA automatically — this is mandatory for UK and EU customers, so test the requires_action path explicitly with Stripe's SCA test cards. Store only the payment-method brand and last 4, never PAN data. Stay SAQ-A by never letting card data touch our servers.
PayPal (secondary): PayPal Orders v2 via the JS SDK button, capture on approval, same webhook-driven state transitions.
Webhooks: one handler per provider, signature verified, event deduplicated by provider event id in WebhookEvent, 200 returned immediately with the real work queued. Idempotent by construction — replaying any event must be a no-op.
Refunds: full and partial, admin-initiated, reflected in the customer's order history, with the supplier-order cancellation state shown alongside so nobody refunds a customer while the tees are already in the post.
Reconciliation: daily job comparing Stripe/PayPal settled amounts against our Order totals; any mismatch raises an alert.
Never trust a client-submitted amount. Prices and totals are recomputed server-side from the cart at intent creation, and the webhook re-verifies that the amount paid equals the order total before the order moves to PAID.
VAT & COMPLIANCE (docs/compliance.md + code)
UK VAT at 20% on golf tees (standard rated). Prices shown to UK consumers must be VAT-inclusive; show the VAT component in the cart, at checkout and on the invoice.
Model a VatMode config: NOT_REGISTERED (no VAT charged or shown, prices are just prices) vs REGISTERED (VAT number captured, VAT calculated, shown and reported). Default to NOT_REGISTERED with a clear admin toggle — do not hardcode either.
Imports: goods arriving from China are consignments the seller is responsible for. Generate a monthly CSV export of orders with supplier cost, ship-from country, HS-code field and declared value so an accountant can handle import VAT/duty. Add a checkout notice that items ship from overseas with realistic delivery estimates.
Consumer Contracts Regulations: 14-day cancellation right, returns policy page, and an order-cancellation window in the admin before the supplier order is placed (default 30-minute hold — make it configurable).
UK GDPR: cookie consent banner, privacy policy, a data-deletion admin action, and no PII in logs.
Emails must include business name, address and company/VAT number placeholders pulled from config.
STOREFRONT

Single-product-line store, but built generically: home/landing page with the bamboo sustainability angle, product listing, product detail (gallery, variant selector, spec table, delivery estimate, reviews placeholder), cart drawer, on-domain checkout (Stripe Elements or PayPal, guest or signed-in), order confirmation, the /account area described above, guest order-status lookup by order number + email, policy pages, contact form. Server components by default, mobile-first, Lighthouse ≥ 90 on performance and accessibility, WCAG 2.2 AA, proper Product + Offer JSON-LD, sitemap, robots, OG images.

ADMIN (/admin, auth-gated)

Dashboard (orders today, revenue, margin, failed fulfilments), product search-and-import from AliExpress (paste a product URL or ID, or keyword search → preview → import → merchandise), variant mapping UI, pricing rules, order list with full lifecycle timeline, manual "retry fulfilment" and "place supplier order now" actions, sync run history, token/health status, settings.

ORDER ORCHESTRATION (/lib/orders)

State machine — model it explicitly, with every transition persisted and audited:

PENDING_PAYMENT → PAID → HOLD (cancellation window) → SUPPLIER_ORDER_QUEUED → SUPPLIER_ORDER_PLACED → SHIPPED → DELIVERED plus SUPPLIER_ORDER_FAILED, CANCELLED, REFUNDED, NEEDS_MANUAL_REVIEW.

Critical requirements:

Stripe checkout.session.completed / payment_intent.succeeded webhook is the only thing that moves an order to PAID. Verify signatures. Dedupe by event id. Return 200 fast and do work in the queue.
Supplier order placement must be idempotent. Generate a deterministic idempotency key per order, persist it before the call, and check for an existing aeOrderId before retrying. A double-charged supplier order is the worst failure mode in this system — write tests specifically for retry-after-timeout and duplicate-webhook scenarios.
Before placing, re-validate: variant still available, supplier price hasn't moved more than X% (configurable, default 10%), shipping still quotes to that address. On violation → NEEDS_MANUAL_REVIEW + admin alert, never auto-place.
Tracking poller job updates Shipment and emails the customer on first tracking number and on delivery.
Refund path: admin-initiated Stripe refund, with a note on whether the supplier order can still be cancelled.
JOBS

product-sync (hourly): refresh price/stock/availability for imported products, apply pricing rules, unpublish on unavailability. place-supplier-order (event-driven, after hold window). poll-tracking (every 6h for orders in SUPPLIER_ORDER_PLACED/SHIPPED). token-refresh (scheduled, ahead of expiry). reconcile (daily): every PAID order older than 2h without a SupplierOrder → alert.

All jobs: idempotent, with dead-letter queue, alerting on repeated failure, and a manual re-run button in admin.

CONFIG (.env.example)

DATABASE_URL, REDIS_URL, ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_CALLBACK_URL, ALIEXPRESS_GATEWAY_URL, TOKEN_ENCRYPTION_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV, AUTH_SECRET, CUSTOMER_AUTH_SECRET, ADMIN_AUTH_SECRET, ADMIN_EMAILS, ENABLE_SOCIAL_LOGIN, AUTH_RATE_LIMIT_PER_MIN, RESEND_API_KEY, SENTRY_DSN, STORE_CURRENCY, VAT_MODE, VAT_NUMBER, ORDER_HOLD_MINUTES, MIN_MARGIN_PCT, PRICE_DRIFT_TOLERANCE_PCT, FX_BUFFER_PCT.

Validate all of it through a Zod schema at boot and fail fast with a readable message.

QUALITY GATES (must pass before any phase is "done")

pnpm typecheck && pnpm lint && pnpm test && pnpm build, plus Playwright e2e for the happy path. Minimum coverage 80% on /lib. Every bug fixed gets a regression test first.

BUILD ORDER
Phase 0 — Scaffold: repo, Next.js, Tailwind, shadcn, Prisma, Docker Compose (Postgres + Redis), env validation, CI (GitHub Actions running the quality gates), docs/decisions.md. Deliver a running "hello store" and stop for my review.
Phase 1 — AliExpress client: read the docs, write docs/aliexpress-api-notes.md, implement OAuth + signing + product detail + search, with fixtures and tests. Add a CLI (pnpm ae:product <id>) so I can verify against a real bamboo tee listing. Stop for review.
Phase 2 — Data model + import pipeline + pricing engine + admin import UI.
Phase 3 — Storefront + cart + checkout + order creation, with Stripe test-mode payments end to end (including the SCA challenge path) and PayPal sandbox behind the same interface.
Phase 3.5 — Customer accounts: sign-up, verification, sign-in, magic link, password reset, session security, rate limiting, guest-cart merge, guest-order claim. Stop for review — this is the part I most want to check before it touches real customers.
Phase 4 — Fulfilment: state machine, queue, supplier order placement (against sandbox/test credentials only until I explicitly say otherwise), tracking, emails — then wire the tracking timeline and order history into /account.
Phase 5 — Compliance pages, VAT modes, exports, GDPR actions, SEO, analytics.
Phase 6 — Hardening: rate limits, observability, runbook, load-test the webhook path, deploy guide.
ACCEPTANCE CRITERIA
docker compose up + pnpm dev gives a working store on a clean machine with only .env filled in.
I can paste an AliExpress bamboo golf tee product URL into admin and have a merchandised, priced, published product on the storefront in under a minute.
A test-mode Stripe purchase produces an Order, waits out the hold window, places exactly one supplier order, and shows the full timeline in admin.
Replaying the same Stripe webhook five times produces exactly one supplier order.
Killing the worker mid-placement and restarting produces exactly one supplier order.
A supplier price rise past the drift tolerance blocks auto-placement and raises an alert instead.
A customer can buy as a guest, then create an account with the same email, verify it, and see that order in their history with a live tracking timeline.
A card requiring 3-D Secure completes successfully, and an abandoned SCA challenge leaves the order in PENDING_PAYMENT with no supplier order placed.
A PayPal sandbox purchase produces an order indistinguishable downstream from a Stripe one.
Signing in from a second device, then using "sign out of all devices", invalidates the first session immediately.
Customer A can never load Customer B's order, invoice PDF, or tracking page — there is an explicit test for every /account and order route asserting this.
"Delete my account" removes PII from the customer record while leaving the financial order record intact and auditable.
The full test suite runs green with no network access.

Start with Phase 0. Before you write code, restate the plan in your own words, flag anything in this spec you think is wrong or risky, and list the decisions you need from me.