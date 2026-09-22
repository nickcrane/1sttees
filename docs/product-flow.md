1st Tees Admin Flow Plan

As of 22 September 2026

Scope and assumptions

The admin flow adds a four-stage pipeline to the 1st Tees store: discover wooden and bamboo golf tees via the AliExpress DS API, normalise their variants, curate them in an admin section, and publish uniform listings written to a house editorial standard.

Assumptions: the store is a standalone build (not Shopify); a DS app key, secret and authorised access token already exist; fulfilment uses aliexpress.ds.order.create; the LLM is called server-side with structured (JSON schema) output.

approve
publish
DS API fetch
Raw supplier_products
LLM pass 1classify + normalise
Admin: Candidates
LLM pass 2listing + images
Validator
Admin: Catalogue
Storefront

Read left to right: supplier data enters once, every LLM output is validated before an admin sees it, and only admin-published products reach the storefront.

Stage 1 — Discovery via the DS API

There is no material filter in the DS API, so "wooden and bamboo" is inferred in Stage 2; Stage 1 casts a wide net and stores everything raw.

Step	Endpoint	Key parameters	Output stored
Keyword search	aliexpress.ds.text.search	keyWord from seed list, countryCode=GB, currency=GBP, local=en_GB, paged	product_id list, de-duplicated
Image search (secondary)	aliexpress.ds.image.search	one good bamboo tee photo	extra product_ids
Full product	aliexpress.ds.product.get	product_id, ship_to_country=GB, target_currency=GBP	title, detail HTML, category, all SKUs with ae_sku_property_dtos, image URLs, package info
Shipping	aliexpress.ds.freight.query	product_id, sku_id, country_code=GB	available services, cost, lead time
Sales and rating	aliexpress.affiliate.product.query (Affiliate API, optional)	product_ids	lastest_volume, evaluate_rate

Seed keywords: bamboo golf tees, wooden golf tees, wood golf tee 70mm, bamboo tee 83mm, natural wood tees bulk, golf tees biodegradable. Add to the list as gaps appear.

Storage: a supplier_products table with product_id, raw_json, fetched_at, last_seen_at, and source (search keyword or image). Run as a scheduled job (nightly) rather than on demand — product.get is one call per item and rate limits are tight.

Open question: does the DS app have Affiliate API scope? Without it there is no orders-volume signal for ranking.

Stage 2 — Classification and variant normalisation (LLM pass 1)

Every raw product goes through one structured-output LLM call that decides suitability and maps messy SKU attributes onto three clean selectors: length, colour and pack size.

SKU naming on AliExpress is inconsistent (Color: Natural, Color: 70mm-100pcs Natural, pack size in the title only), so the model receives the title, detail text and every ae_sku_property_dtos entry, and must return this schema:

json
{
  "material": "bamboo | wood | plastic | mixed | unknown",
  "is_suitable": true,
  "reject_reason": null,
  "variants": [
    { "sku_id": "12000012345", "length_mm": 70, "colour": "Natural", "pack_size": 100, "price_gbp": 4.12, "stock": 830 }
  ],
  "confidence": 0.92
}

Normalisation rules: length in millimetres (2¾″ → 70, 3¼″ → 83); colour from a controlled list (Natural, White, Black, Mixed, Printed, Other); pack size an integer. is_suitable is false for plastic tees, accessories, or bundles with other kit.

Routing: is_suitable=true and confidence ≥ 0.8 → products + product_variants tables, status candidate; anything else → a review queue in admin, never silently dropped. Each variant keeps its sku_id so the storefront dropdowns map straight back to the SKU used in aliexpress.ds.order.create.

Stage 3 — Admin curation

One admin area with three views; a product moves from candidate to published only through explicit admin actions.

View	Shows	Actions
Candidates	Classifier-accepted products: supplier images, landed price, orders volume, rating, stock, margin at target price; filters on material, length, colour, pack size	Approve / Reject / Park; link to source page
Catalogue	Approved products with their generated listing (Stage 4), validator status, retail price	Publish / Unpublish; edit any field in place; regenerate listing
Sync log	Job runs, API errors, price and stock drift since last fetch, products delisted at source	Retire; re-run
Review queue	Low-confidence or rejected-by-classifier products	Override classification; send to Candidates
approve
reject
park
publish
unpublish
delisted / retire
candidate
approved
rejected
parked
published
retired

Retail price comes from a margin rule (e.g. landed cost × 2.4, rounded to .99) with a per-product manual override. Supplier price and stock re-sync nightly for anything approved or published; a variant hitting zero stock is hidden from the storefront automatically and flagged in the Sync log.

Stage 4 — Listing generation and the 1st Tees editorial standard (LLM pass 2)

Every approved product is rewritten into one fixed listing shape by a second structured-output LLM call, then checked by a validator before it reaches the Catalogue. The standard below is the system prompt's content: if Apple sold golf tees.

Voice

Quiet confidence. Short declarative sentences. British English. The product is the hero; the copy says what it is and what it does, then stops.

Do	Don't
"Cut from a single piece of bamboo. Splits less. Lasts longer."	"Premium eco-friendly bamboo tees for the discerning golfer!"
Concrete facts: 70mm, 100 tees, kraft box	Adjectives: premium, high quality, amazing, durable and practical
Second person sparingly	Exclamation marks, emoji, "for golf lovers"
"—" where a fact is unknown	Any claim not supported by supplier data
Fixed listing structure

Every listing has these fields, in this order, always all present:

Name — pattern [Material] Tee · [Length]mm, e.g. "Bamboo Tee · 70mm". Colour and pack size never appear in the name.
Headline — one sentence, under 12 words, the single distinguishing benefit.
Overview — exactly two paragraphs of 40–70 words. First: what it is and what it is made of. Second: how it plays (tee height, driver or iron use, break resistance).
Specification — fixed keys: Material · Length · Head diameter · Colour options · Pack sizes · Finish · Biodegradable (Yes/No) · Weight per tee · Country of origin. "—" if unknown.
In the box — one line, e.g. "50 tees, kraft box."
Sustainability — one sentence, only where the material is genuinely bamboo or wood; never invented.
Selectors — Length, Colour, Pack size, in that order, each a dropdown built from the normalised variants.
Images

Exactly four slots, always in the same order and treatment.

Slot	Content	Source
1 Hero	Single tee or small fan of tees, plain off-white background	Best-scoring supplier image, background normalised
2 Detail	Tip or head close-up	Supplier image
3 Scale	Tees in hand or beside a ball	Supplier image
4 Pack	Retail quantity as shipped	Supplier image

Pipeline: a vision call scores every supplier image against the four roles and picks the best fit per slot. All images are cropped 1:1, background removed or set to the house off-white, and output at 1600×1600 WebP. Images with watermarks, overlaid text, red arrows or collage layouts are rejected. Fewer than three filled slots blocks publishing until an admin uploads replacements.

Validator (hard fail → Catalogue shows "needs review")
Word counts per section within range
Name matches the pattern
All nine specification keys present
No banned words (superlatives, supplier-speak), no exclamation marks, no emoji
No URLs, seller names or brand names other than 1st Tees in copy
Every specification value traceable to supplier data or "—"
Four image slots filled, each passing the image checks
Build order and known constraints

Five weeks of build, each ending with something usable in admin.

Week	Deliverable
1	DS API client with token refresh; text.search, product.get, freight.query; supplier_products table; nightly fetch job
2	LLM pass 1 with the schema above; products and product_variants tables; review queue
3	Admin Candidates and Catalogue views; status model; margin pricing rule
4	LLM pass 2, image pipeline, validator; storefront rendering of the fixed template
5	Nightly re-sync, stock and price drift handling, retirement of delisted products; order placement via aliexpress.ds.order.create

Constraints to plan around:

text.search returns a shallow slice of the catalogue; seed it with a broad keyword list and use image search as a second discovery route.
Material, length and pack size are never reliable in structured fields; the LLM pass is the source of truth, with admin override.
LLM cost is negligible at this scale (a few hundred products, two calls each), so re-run both passes on every fetch rather than caching aggressively.
Supplier images are the weakest input; expect to shoot your own hero images for the products you keep long-term.