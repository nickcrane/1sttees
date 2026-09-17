# AliExpress Open Platform — DS API notes

Everything below was read directly from `https://openservice.aliexpress.com` (the
"DropShippers API Developer" section, plus the general "Developer's Guide" for
gateway/signing mechanics) on 2026-09-17, cross-checked against the sibling
[aliexpress-dashboard](../../aliexpress-dashboard) project's own live-confirmed
findings (Python, same `aliexpress.ds.*` family, real credentials, running since
September 2026 — see that repo's README and `docs/aliexpress_ds_api_confirmed_facts`
in this account's Claude memory). Where the two disagreed, that's called out
explicitly rather than silently picking one. Per this project's Rule 1, nothing
here is invented — every claim below has a doc URL or a "confirmed live by
aliexpress-dashboard" note next to it. Nothing in this document has been
confirmed live *by this project* yet — no AliExpress app exists for 1stees
yet (see [Open items](#open-items-that-need-you)).

## Business model (read this first)

A dropshipper integrates as a **buyer**, not a seller. Two manual steps outside
any API, done once by a human in a browser:
1. Register a normal AliExpress **buyer** account (not a seller account).
2. In AliExpress's **DS Center**, read and sign the *AliExpress Dropshipping
   Program User Agreement*. This activates "dropshipper" status on that buyer
   account — without it, the DS-family APIs won't work regardless of app
   permissions.

Source: [Beginner's Guide For Dropshipping](https://openservice.aliexpress.com/doc/doc.htm) (DropShippers API Developer → Quick Start).

## Gateway and endpoint conventions

Confirmed from [API endpoint URLs](https://openservice.aliexpress.com/doc/doc.htm#/?docId=1388) (updated 2024-05-07):

All APIs split into two categories, each with its own URL shape:

- **Business interfaces** — every dotted `aliexpress.*` method (`aliexpress.ds.product.get`, `aliexpress.ds.text.search`, `aliexpress.ds.order.create`, `aliexpress.ds.freight.query`, `aliexpress.ds.order.tracking.get`, `aliexpress.trade.ds.order.get`, etc.):
  ```
  POST https://api-sg.aliexpress.com/sync?method={api_path}&{query}
  ```
- **System interfaces** — the path-style auth endpoints, listed under "System Tool":
  ```
  POST https://api-sg.aliexpress.com/rest{api_path}?{query}
  ```
  e.g. `https://api-sg.aliexpress.com/rest/auth/token/create`

- **OAuth authorize (browser redirect, not a signed API call)**:
  ```
  https://api-sg.aliexpress.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri={callback_url}&client_id={app_key}
  ```

Matches `aliexpress-dashboard`'s confirmed-live `_DOMAIN = "api-sg.aliexpress.com"`,
port 443, HTTPS-only.

## Signing algorithm — MD5, the classic "secret-wrap" scheme, not HMAC

Three sources here, and they don't all agree — resolved by going to actual
working code rather than picking whichever doc reads most authoritative:

- The platform's own [Signature algorithm](https://openservice.aliexpress.com/doc/doc.htm#/?docId=1367) doc (updated 2024-03-29) documents **HMAC-SHA256** (`sign_method=sha256`) with full pseudocode and a Java sample, but no worked numeric example (no sample secret/output to verify against).
- The platform's own [[Important] Developers Notice](https://openservice.aliexpress.com/doc/doc.htm#/?docId=1392) (updated 2025-05-06, migrating developers off the old Taobao Open Platform gateway) gives a worked "before → after" URL-migration example where **both** the old and new gateway URLs use `sign_method=md5`.
- `python-aliexpress-api`'s `RestApi.getResponse()` — the exact code `aliexpress-dashboard` runs live, successfully, against `aliexpress.ds.*` today — has a real, readable `sign()` function. This is not a guess or a doc reading; it's the literal source of a working integration:
  ```python
  def sign(secret, parameters):
      keys = sorted(parameters.keys())
      parameters = "%s%s%s" % (
          secret,
          "".join("%s%s" % (key, parameters[key]) for key in keys),
          secret,
      )
      return hashlib.md5(parameters.encode("utf-8")).hexdigest().upper()
  ```
  (`/Users/nick/Dev/aliexpress-dashboard/.venv/lib/python3.11/site-packages/aliexpress_api/skd/api/base.py`)

**This project uses that exact scheme** — proven live, and the simpler of
the two to reason about. It is **not** HMAC-MD5: the secret is concatenated
directly before and after the sorted key-value string, then the whole thing
is run through plain MD5. `sign_method` is a declared request parameter
either way, so switching to the documented HMAC-SHA256 later (if MD5 is ever
deprecated) only means swapping the hash step, not the surrounding request
shape.

**Algorithm actually implemented:**

1. Build one flat params object: all system params (see below) **plus** all
   business params for this call, `method` included as a normal param (its
   value is the dotted API name, e.g. `aliexpress.ds.product.get`) —
   confirmed from the working source: `method` is just another entry in the
   same dict that gets signed, not special-cased. Exclude only `sign` itself.
2. Sort keys byte-wise ascending (plain `Array.sort()` on strings gives this
   for the ASCII param names in use here).
3. Concatenate as `secret + key1value1key2value2... + secret` (secret
   wrapped around the front *and* back — easy to miss, confirmed from the
   source above, not from any doc).
4. UTF-8 encode, MD5 hash, hex-encode, **uppercase**. This is `sign`.

**Cross-checked test vectors** (computed by literally running the Python
`sign()` function above in this environment, so the TypeScript port has
something real to assert against — see `tests/unit/aliexpress/sign.test.ts`):
```
sign("testsecret", {foo:"1", bar:"2", foo_bar:"3", foobar:"4"})
  → "54C22189FE38F1B7E6E4D701FB82851E"

sign("my_app_secret_123", {app_key:"12345678", method:"aliexpress.ds.product.get",
  timestamp:"1700000000000", format:"json", v:"2.0", sign_method:"md5",
  partner_id:"taobao-sdk-python-20200924", session:"test-access-token",
  product_id:"1005001234567890", ship_to_country:"GB", target_currency:"GBP",
  target_language:"en_US"})
  → "3C285A05E7275C1E100E170EFA715F1E"
```

## System parameters (every request)

The current [Calling parameters](https://openservice.aliexpress.com/doc/doc.htm#/?docId=1369) doc (updated 2024-03-29) only lists `app_key`,
`access_token`, `timestamp`, `sign_method`, `sign` — but the actual working
implementation sends a larger, TOP-legacy-compatible set, and **the docs page
is the less reliable source here** (confirmed pattern: this platform's docs
and live behavior disagree; go with what a real, currently-working
integration sends). This project sends:

| Param | Value | Source |
|---|---|---|
| `app_key` | your app key | both sources agree |
| `method` | dotted API name, e.g. `aliexpress.ds.product.get` — omitted for System interfaces, which use the path-based URL instead | working impl |
| `session` | the OAuth access token | working impl uses `session`, **not** `access_token` as the docs' table implies. `access_token` may also be the accepted name on the current gateway (untested) — send it as an alias too rather than trust one name until a real call confirms which one the gateway actually reads |
| `timestamp` | epoch-milliseconds string, e.g. `"1700000000000"` | working impl. Current docs also allow this form (alongside `2017-11-11T12:00:00Z`), so no conflict |
| `format` | `"json"` | working impl; not in the docs' trimmed table |
| `v` | `"2.0"` | working impl; not in the docs' trimmed table |
| `sign_method` | `"md5"` | see above |
| `partner_id` | a free-text client identifier string (e.g. `"1stees-node"`) | working impl sends an SDK-version-style string here; gateway doesn't appear to validate its content, just that it's present |
| `sign` | see signing section | both sources agree |

**Request shape**: system params (incl. `sign`) go in the **URL query
string**; business params go in the **POST body**, `application/
x-www-form-urlencoded`. Both business-interface calls (`/sync?{system
params}`) and system-interface calls (`/rest{path}?{system params}`) follow
this split in the working implementation.

## Response envelope

Confirmed inconsistent by `aliexpress-dashboard` across three shapes
(unwrapped `{result,...}`, one-level `{"<method>_response": {...}}`, and a
nested `resp_result`) — the `aliexpress.ds.order.create` response sample on
this platform's own docs matches the one-level `{"aliexpress_ds_order_create_response": {"result": {...}}}` shape, consistent with that finding. Build the
client to auto-detect the wrapper (as aliexpress-dashboard's `_unwrap_envelope`
already does), not hardcode one shape.

## OAuth flow and token lifetime

1. Browser redirect to the `/oauth/authorize` URL above; user logs in and
   approves; AliExpress redirects to your `redirect_uri` with `?code=...`.
2. Exchange `code` via **System interface** `/auth/token/create` (POST) →
   `{access_token, refresh_token, expires_in, refresh_expires_in, ...}`.
3. Refresh via **System interface** `/auth/token/refresh` (POST), passing
   `refresh_token`. Rotates both tokens — **always persist the new
   `refresh_token` from the response**, but if a response omits it, keep the
   previous one rather than nulling it out (aliexpress-dashboard hit exactly
   this bug once — an unrotated refresh response nulling the stored token
   permanently broke refreshing until re-auth).

**Token lifetime depends on app launch status** — this is new information
that corrects the original mission brief's "~365/730 day" assumption *and*
adds a nuance aliexpress-dashboard's README didn't have, because that app is
presumably still in test status:

| App status | `expires_in` (access) | `refresh_expires_in` (refresh) |
|---|---|---|
| Test (default for a new app) | 86400s (24h) | 172800s (48h) |
| Launched / approved | 2,592,000s (30 days) | ~5,184,000s (60 days) |

Source: [Authorize your APP](https://openservice.aliexpress.com/doc/doc.htm#/?docId=1364), "About App launch" section. The 24h/48h test-status numbers match aliexpress-dashboard's confirmed-live experience exactly. **Action for later**: once 1stees's AliExpress app is stable, apply to have it "launched" — cuts the `token-refresh` job from near-daily to effectively monthly.

## Methods confirmed to exist (current names — several differ from the mission brief's guesses)

| Purpose | Method (confirmed current) | Mission brief guessed |
|---|---|---|
| Product detail | `aliexpress.ds.product.get` | ✅ matches |
| Keyword search | `aliexpress.ds.text.search` | ✅ matches |
| Image search | `aliexpress.ds.image.searchV2` | (not in brief — bonus) |
| Category tree | `aliexpress.ds.category.get`* | (not named in brief) |
| Freight/shipping quote | `aliexpress.ds.freight.query` | ✅ matches |
| Ship-to address helper | `aliexpress.ds.address.get` | (not in brief) |
| **Order placement** | **`aliexpress.ds.order.create`** | ❌ brief said `aliexpress.trade.buy.placeorder` — that name doesn't appear anywhere in current docs |
| Order detail | `aliexpress.trade.ds.order.get` | brief guessed `aliexpress.ds.trade.order.get` — word order differs |
| Tracking | `aliexpress.ds.order.tracking.get` | ✅ matches |

\* `aliexpress.ds.category.get` wasn't re-confirmed on the current docs site
during this pass, but is confirmed live by aliexpress-dashboard, still exists
in its client, and nothing in the current docs suggests it's gone.

**Correction to make to the mission brief**: use `aliexpress.ds.order.create`
everywhere the brief said `aliexpress.trade.buy.placeorder`.

## `aliexpress.ds.order.create` — the order-placement method, in detail

Full reference: `https://openservice.aliexpress.com/doc/api.htm#/api?cid=21038&path=aliexpress.ds.order.create&methodType=GET/POST`

- **Idempotency is native and exactly matches what the mission brief asked
  for**: pass `out_order_id` (your own order number) in
  `param_place_order_request4_open_api_d_t_o`. AliExpress uses it to dedupe
  retried placements — but **the idempotency window is 24 hours**, not
  indefinite. Since this project places the supplier order right after a
  short (default 30-minute) hold window, that's comfortably inside the
  window, but it's worth asserting on rather than assuming.
- **Order creation and payment are two separate internal steps, and a
  response can report success on one and failure on the other.** A response
  with `is_success: true` still needs its `error_msg` checked — e.g.
  `"OrderCreated, autoPay fail:APIPayFail"` means the AliExpress order exists
  but is **unpaid**, alongside `is_success: true` and a real `order_list`.
  **The order state machine must not treat `is_success: true` alone as
  "placed and will ship"** — an unpaid AliExpress order won't be fulfilled by
  the supplier. This needs its own check (probably its own
  `SUPPLIER_ORDER_PLACED_UNPAID`-type sub-state feeding `NEEDS_MANUAL_REVIEW`)
  rather than folding into the existing `SUPPLIER_ORDER_FAILED` transition.
- Request needs the buyer's shipping address in AliExpress's own field
  shape (`logistics_address`: `country` as ISO-2, `city`, `province`
  required; `zip`, `contact_person`, phone fields, and a handful of
  per-country fields — `cpf` for Brazil, `passport_no` for Mexico, `vat_no`,
  etc. — optional/conditional per destination country). One `product_items`
  entry per SKU: `product_id`, `product_count`, `sku_attr` (verbatim from
  `aliexpress.ds.product.get` — this is exactly the `skuAttrs` field the
  domain model already plans to store verbatim on `SupplierVariant`),
  `logistics_service_name` (from `aliexpress.ds.freight.query`).
- Documented error codes worth typing explicitly in `AliExpressError`:
  `B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL`, `DELIVERY_METHOD_NOT_EXIST`,
  `INVENTORY_HOLD_ERROR`, `REPEATED_ORDER_ERROR`, `PRICE_PAY_CURRENCY_ERROR`,
  `BLACKLIST_BUYER_IN_LIST`, `USER_ACCOUNT_DISABLED`, `A001_ORDER_CANNOT_BE_PLACED`
  through `A006_INVALID_ACCOUNT_INFO`. `DELIVERY_METHOD_NOT_EXIST` specifically
  means: call `aliexpress.ds.freight.query` first and use a
  `logistics_service_name` it actually returned — don't guess one.
- **Cancelling an already-placed order has no API** — the docs say to log
  into the AliExpress website with the account that placed it and cancel
  manually. Relevant to the spec's refund/cancellation-window design: the
  30-minute hold window is what makes cancellation *before* placement free;
  after placement, cancellation is a manual, human, per-order action, not
  something the worker can automate.

## Automatic payment — requires a manual application + a funded PayPal account (flagging per Rule 2)

This is the biggest new finding, and it's an operational/business dependency,
not a coding one — flagging per this project's Rule 2 ("stop and ask... a
required permission I may not have been granted... anything that would cost
money to test").

Source: [How to use API Pay](https://openservice.aliexpress.com/doc/doc.htm) (DropShippers API Developer → FAQ).

- `aliexpress.ds.order.create` *can* auto-pay (`ds_extend_request.payment.try_to_pay: true`), but **only after AliExpress's DS business team manually whitelists your `app_key`.** You apply by emailing `ds-api@aliexpress.com` with: your key markets, the AliExpress buyer account used for API payment, **a PayPal account bound to that AliExpress account**, and your AliExpress user/login ID. There's no self-service API for this.
- **Only USD is supported** as the auto-pay currency today ("in the future we will try to support all currency that can be used in PayPal"). The landed-cost/pricing engine already assumes supplier prices in USD with an FX buffer, so this is consistent, but it does mean the AliExpress-side leg of every order is charged in USD off a PayPal balance, regardless of what the customer paid in GBP.
- Supported destination countries for auto-pay are listed explicitly and **include the UK** (`GB` / "United Kingdom of Great Britain and Northern Ireland") — so this isn't a blocker for a UK-based store, just a setup step.
- If `try_to_pay` is `false` or unset, orders are created but sit unpaid until someone pays manually on the AliExpress site — not viable for an automated fulfilment pipeline.

**What this means for the build order**: Phase 1 (this phase) doesn't touch
this at all — OAuth, signing, product detail, and search all work without
auto-pay. But **Phase 4 (fulfilment) cannot be finished end-to-end** until
you've: (1) registered the new dedicated AliExpress buyer account and signed
the DS Center agreement, (2) created a PayPal account (or used an existing
one) and bound it to that AliExpress account, and (3) emailed AliExpress's DS
team and been approved for the auto-pay whitelist. None of that is something
I can do — it needs your identity and your PayPal account. Worth starting
early since "manually reviewed by AliExpress" implies unknown turnaround
time. Building Phase 4 against sandbox/mocked payment first (as the mission
brief already says to do) means this doesn't block writing the code, only
running it against real money.

## Webhooks — better than polling for order status

Not asked for in the mission brief, but directly useful for Phase 4's order
orchestration: AliExpress pushes order lifecycle events to a callback URL you
register in the App Console (Notification tab), subscribed to the
`DROPSHIPPER_ORDER_STATUS_UPDATE` topic.

```json
{
  "data": { "buyerId": 1861703697, "orderId": 1105933950463697, "orderStatus": "paymentFailedEvent" },
  "message_type": 53,
  "seller_id": "1234",
  "site": "ae_global",
  "timestamp": 1719389200
}
```

`orderStatus` values seen in the docs: `paymentFailedEvent`, `OrderCreated`,
`OrderClosed`, `PaymentAuthorized`, `OrderShipped`, `OrderConfirmed`. This
should replace or supplement the `poll-tracking` job's reliance on polling
`aliexpress.trade.ds.order.get` — particularly useful for catching
`paymentFailedEvent` quickly (see the create-vs-pay split above) and for
triggering the "first tracking number" customer email off `OrderShipped`
rather than waiting for the next poll cycle. Note: **the payload doesn't
carry a signature/verification scheme documented on this page** — worth
checking the separate "Message Push service (webhook)" doc (docId 1478, not
yet read in full) before trusting inbound payloads; it mentions "HMAC-SHA256
based on the AppKey" for verifying these, which should be confirmed before
Phase 4 wires up the webhook receiver.

## Rate limits

Not yet read (the DS docs have an "API QPS" page under Quick Start that
wasn't opened in this pass). Needs confirming before Phase 1's rate limiter
is tuned — using a conservative default (aliexpress-dashboard's
`AE_MIN_REQUEST_INTERVAL_SECONDS=1.0`) until then.

## Open items that need you

1. **Register the new dedicated AliExpress Open Platform app** (per the
   earlier decision to not reuse aliexpress-dashboard's). Needs: a buyer
   account, the DS Center agreement signed, an app created under the "Drop
   Shipping" category, and the "Drop Shipping" + "System Tool" permission
   groups granted.
2. Until that exists, Phase 1's CLI (`pnpm ae:product <id>`) can only be
   verified in fixture mode — I'll build it to work either way, but actually
   checking it against a real bamboo tee listing needs your `app_key`/
   `app_secret` and a completed OAuth authorization.
3. **Auto-pay whitelist application** (email to `ds-api@aliexpress.com` +
   a PayPal account bound to the AliExpress buyer account) — not needed
   until Phase 4, but worth starting given the unknown review turnaround.
