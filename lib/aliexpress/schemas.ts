import { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * Raw response shapes, kept deliberately loose (`.passthrough()`, most
 * fields optional) -- confirmed live by the sibling aliexpress-dashboard
 * project that this API's actual responses routinely diverge from its own
 * docs. Strict fields below are the ones that project has specifically
 * confirmed live; everything else is a best-effort guess flagged in
 * docs/aliexpress-api-notes.md as unconfirmed until this project has its
 * own live credentials to check against.
 */

export const tokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    expires_in: z.coerce.number().optional(),
    refresh_expires_in: z.coerce.number().optional(),
  })
  .passthrough();
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// aliexpress.ds.text.search: one item of `data.products[]`. Field names
// (itemId, itemUrl, cateId as a comma-separated path, orders as a possibly
// bucketed string) confirmed live by aliexpress-dashboard.
export const rawSearchProductSchema = z
  .object({
    itemId: z.union([z.string(), z.number()]),
    title: z.string().optional(),
    itemUrl: z.string().optional(),
    itemMainPic: z.string().optional(),
    productVideoUrl: z.string().optional(),
    cateId: z.union([z.string(), z.number()]).optional(),
    salePrice: z.union([z.string(), z.number()]).optional(),
    salePriceCurrency: z.string().optional(),
    originalPrice: z.union([z.string(), z.number()]).optional(),
    originalPriceCurrency: z.string().optional(),
    targetSalePrice: z.union([z.string(), z.number()]).optional(),
    discount: z.union([z.string(), z.number()]).optional(),
    evaluateRate: z.union([z.string(), z.number()]).optional(),
    orders: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
export type RawSearchProduct = z.infer<typeof rawSearchProductSchema>;

export const searchResponseDataSchema = z
  .object({
    // Confirmed live: NOT a bare array despite the docs -- arrives one
    // level deeper, wrapped in a single-key object whose inner key varies
    // (`{"selection_search_product": [...]}` seen so far). `z.unknown()`
    // here deliberately -- see `extractList` for how this actually gets
    // unwrapped, and `docs/aliexpress-api-notes.md`.
    products: z.unknown().optional(),
    pageIndex: z.union([z.string(), z.number()]).optional(),
    totalCount: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

// aliexpress.ds.product.get: `result` is nested DTOs, confirmed live by
// aliexpress-dashboard for the base-info/multimedia fields used below.
// Per-SKU fields (sku_id, sku_attr) are NOT yet confirmed by any live call
// this account has made -- they're modeled per the shape AliExpress's own
// aliexpress.ds.order.create docs imply (`sku_attr` values like
// "14:175;5:200003528#Length -26cm" are passed verbatim from here at order
// time), but treat them as provisional until checked against a real
// response. See docs/aliexpress-api-notes.md "Open items".
export const rawSkuSchema = z
  .object({
    sku_id: z.union([z.string(), z.number()]).optional(),
    sku_attr: z.string().optional(),
    sku_price: z.union([z.string(), z.number()]).optional(),
    offer_sale_price: z.union([z.string(), z.number()]).optional(),
    currency_code: z.string().optional(),
  })
  .passthrough();

export const rawProductDetailResultSchema = z
  .object({
    ae_item_base_info_dto: z
      .object({
        product_id: z.union([z.string(), z.number()]),
        subject: z.string().optional(),
        sales_count: z.union([z.string(), z.number()]).optional(),
        category_id: z.union([z.string(), z.number()]).optional(),
        evaluation_count: z.union([z.string(), z.number()]).optional(),
        avg_evaluation_rating: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
    // Same single-key-wrapped-list quirk as text.search's `products` --
    // confirmed live for this field too (`{"ae_item_sku_info_d_t_o": [...]}`).
    // See extractList.
    ae_item_sku_info_dtos: z.unknown().optional(),
    ae_multimedia_info_dto: z
      .object({
        image_urls: z.string().optional(), // semicolon-separated, not an array -- confirmed live
        // Same wrapped-list quirk again (`{"ae_video_d_t_o": [...]}`).
        ae_video_dtos: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type RawProductDetailResult = z.infer<typeof rawProductDetailResultSchema>;

// aliexpress.ds.freight.query: confirmed live (2026-09-17) against a real
// bamboo golf tee product/SKU. `delivery_options` has the same
// single-key-wrapped-list quirk as everything else in this family
// (`{"delivery_option_d_t_o": [...]}`) -- see extractList.
export const rawDeliveryOptionSchema = z
  .object({
    code: z.string().optional(), // delivery service code -- needed at order placement time
    company: z.string().optional(),
    shipping_fee_format: z.string().optional(),
    shipping_fee_cent: z.union([z.string(), z.number()]).optional(),
    shipping_fee_currency: z.string().optional(),
    free_shipping: z.boolean().optional(),
    delivery_date_desc: z.string().optional(),
    min_delivery_days: z.union([z.string(), z.number()]).optional(),
    max_delivery_days: z.union([z.string(), z.number()]).optional(),
    ship_from_country: z.string().optional(),
    tracking: z.boolean().optional(),
  })
  .passthrough();
export type RawDeliveryOption = z.infer<typeof rawDeliveryOptionSchema>;

export const rawFreightResultSchema = z
  .object({
    success: z.boolean().optional(),
    code: z.union([z.string(), z.number()]).optional(),
    msg: z.string().optional(),
    delivery_options: z.unknown().optional(),
  })
  .passthrough();
export type RawFreightResult = z.infer<typeof rawFreightResultSchema>;

export const normalizedFreightOptionSchema = z.object({
  code: z.string().nullable(), // pass verbatim as logistics_service_name at order placement
  company: z.string().nullable(),
  shippingFeeFormatted: z.string().nullable(),
  shippingFeeMajor: z.number().nullable(),
  shippingFeeCurrency: z.string().nullable(),
  freeShipping: z.boolean().nullable(),
  deliveryDateDesc: z.string().nullable(),
  minDeliveryDays: z.number().nullable(),
  maxDeliveryDays: z.number().nullable(),
  shipFromCountry: z.string().nullable(),
  trackingAvailable: z.boolean().nullable(),
});
export type NormalizedFreightOption = z.infer<typeof normalizedFreightOptionSchema>;

// aliexpress.ds.order.tracking.get: confirmed shape per current docs, not
// yet exercised live (needs a real order id, which doesn't exist yet).
// Triple-nested wrapped-list quirk, same pattern as everywhere else --
// tracking_detail_line_list -> detail_node_list -> package_item_list.
export const rawTrackingDetailNodeSchema = z
  .object({
    tracking_name: z.string().optional(),
    tracking_detail_desc: z.string().optional(),
    time_stamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const rawTrackingPackageItemSchema = z
  .object({
    item_id: z.union([z.string(), z.number()]).optional(),
    item_title: z.string().optional(),
    sku_desc: z.string().optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const rawTrackingDetailLineSchema = z
  .object({
    mail_no: z.string().optional(),
    carrier_name: z.string().optional(),
    eta_time_stamps: z.union([z.string(), z.number()]).optional(),
    detail_node_list: z.unknown().optional(),
    package_item_list: z.unknown().optional(),
  })
  .passthrough();

export const rawTrackingResultSchema = z
  .object({
    ret: z.boolean().optional(),
    code: z.string().optional(),
    msg: z.string().optional(),
    data: z
      .object({ tracking_detail_line_list: z.unknown().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type RawTrackingResult = z.infer<typeof rawTrackingResultSchema>;

export const normalizedTrackingLineSchema = z.object({
  mailNo: z.string().nullable(),
  carrierName: z.string().nullable(),
  etaTimestamp: z.number().nullable(),
  events: z.array(
    z.object({
      name: z.string().nullable(),
      description: z.string().nullable(),
      timestamp: z.number().nullable(),
    })
  ),
});
export type NormalizedTrackingLine = z.infer<typeof normalizedTrackingLineSchema>;

// aliexpress.trade.ds.order.get: confirmed shape per current docs, not yet
// exercised live (needs a real order id). Money fields are `{amount,
// currency_code}` objects throughout, not flat numbers -- confirmed
// pattern from the docs' own worked example.
const rawMoneySchema = z.object({ amount: z.union([z.string(), z.number()]).optional(), currency_code: z.string().optional() }).passthrough();

export const rawOrderDetailResultSchema = z
  .object({
    gmt_create: z.string().optional(),
    order_status: z.string().optional(),
    logistics_status: z.string().optional(),
    user_order_amount: rawMoneySchema.optional(),
    logistics_info_list: z.unknown().optional(),
    store_info: z.unknown().optional(),
    child_order_list: z.unknown().optional(),
  })
  .passthrough();
export type RawOrderDetailResult = z.infer<typeof rawOrderDetailResultSchema>;

// -- Normalized, domain-facing shapes --------------------------------------

export const normalizedProductSchema = z.object({
  productId: z.string(),
  title: z.string().nullable(),
  productUrl: z.string().nullable(),
  imageUrls: z.array(z.string()),
  videoUrl: z.string().nullable(),
  categoryId: z.string().nullable(),
  salePrice: z.number().nullable(),
  salePriceCurrency: z.string().nullable(),
  targetSalePrice: z.number().nullable(),
  targetSalePriceCurrency: z.string().nullable(),
  reviewCount: z.number().nullable(),
  avgRating: z.number().nullable(),
  salesVolume: z.number().nullable(),
  salesVolumeDisplay: z.string().nullable(),
  skus: z
    .array(
      z.object({
        skuId: z.string().nullable(),
        skuAttrs: z.string(), // verbatim -- required as-is at order placement time
        price: z.number().nullable(),
        offerSalePrice: z.number().nullable(),
        currency: z.string().nullable(),
      })
    )
    .default([]),
});
export type NormalizedProduct = z.infer<typeof normalizedProductSchema>;

export const normalizedSearchProductSchema = z.object({
  productId: z.string(),
  title: z.string().nullable(),
  productUrl: z.string().nullable(),
  mainImageUrl: z.string().nullable(),
  categoryId: z.string().nullable(),
  targetSalePrice: z.number().nullable(),
  targetSalePriceCurrency: z.string(),
  discountPct: z.number().nullable(),
  evaluateRatePct: z.number().nullable(),
  salesVolume: z.number().nullable(),
  salesVolumeDisplay: z.string().nullable(),
});
export type NormalizedSearchProduct = z.infer<typeof normalizedSearchProductSchema>;

// -- Parsing helpers, ported from aliexpress-dashboard's normalize.py -----

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toPercent(value: unknown): number | null {
  if (typeof value === "string") return toNumber(value.trim().replace(/%$/, ""));
  return toNumber(value);
}

/** A bucketed count like "1000+" parses to a best-effort floor, keeping the original text. */
function toBucketedCount(value: unknown): { count: number | null; display: string | null } {
  if (value === null || value === undefined) return { count: null, display: null };
  const display = String(value);
  if (typeof value === "number") return { count: value, display };
  const cleaned = display.trim().replace(/\+$/, "").replace(/,/g, "");
  return { count: toNumber(cleaned), display };
}

function normalizeUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.startsWith("//") ? `https:${value}` : value;
}

function leafCategoryId(cateId: unknown): string | null {
  if (cateId === null || cateId === undefined) return null;
  const segments = String(cateId)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/**
 * Several confirmed-live ds.* response fields that "should" be a bare array
 * per the docs actually arrive one level deeper, wrapped in a single-key
 * object -- `data.products` as `{"selection_search_product": [...]}`,
 * `ae_item_sku_info_dtos` as `{"ae_item_sku_info_d_t_o": [...]}`,
 * `ae_video_dtos` as `{"ae_video_d_t_o": [...]}`. Confirmed against a real
 * live call (see docs/aliexpress-api-notes.md) and ported from
 * aliexpress-dashboard's own `extract_list`, which hit the same thing. The
 * exact inner key varies (and may vary further by call type in ways not yet
 * confirmed), so this takes the first list-valued entry found rather than
 * hardcoding each one.
 */
export function extractList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    for (const inner of Object.values(value)) {
      if (Array.isArray(inner)) return inner;
    }
    return [value]; // a single (non-wrapped) item -- keep prior single-object fallback
  }
  return [];
}

/** Extracts a list field, validates each item, and logs+drops anything that doesn't fit rather than failing the whole batch. */
export function extractValidItems<T>(value: unknown, schema: z.ZodType<T>, context: { method: string; field: string }): T[] {
  const items: T[] = [];
  for (const raw of extractList(value)) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      logger.warn(
        { method: context.method, field: context.field, issues: parsed.error.issues, raw },
        `dropped one ${context.field} item that didn't match the expected shape`
      );
    }
  }
  return items;
}

export function normalizeSearchProduct(raw: RawSearchProduct, targetCurrency: string): NormalizedSearchProduct {
  const { count: salesVolume, display: salesVolumeDisplay } = toBucketedCount(raw.orders);
  return {
    productId: String(raw.itemId),
    title: raw.title ?? null,
    productUrl: normalizeUrl(raw.itemUrl),
    mainImageUrl: raw.itemMainPic ?? null,
    categoryId: leafCategoryId(raw.cateId),
    targetSalePrice: toNumber(raw.targetSalePrice),
    targetSalePriceCurrency: targetCurrency,
    discountPct: toPercent(raw.discount),
    evaluateRatePct: toPercent(raw.evaluateRate),
    salesVolume,
    salesVolumeDisplay,
  };
}

const rawVideoSchema = z.object({ media_url: z.string().optional() }).passthrough();

export function normalizeProductDetail(raw: RawProductDetailResult, targetCurrency: string): NormalizedProduct {
  const base = raw.ae_item_base_info_dto;
  if (!base || base.product_id === undefined) {
    throw new Error("product detail payload is missing ae_item_base_info_dto.product_id");
  }
  const skus = extractValidItems(raw.ae_item_sku_info_dtos, rawSkuSchema, {
    method: "aliexpress.ds.product.get",
    field: "ae_item_sku_info_dtos",
  });

  const multimedia = raw.ae_multimedia_info_dto;
  const imageUrls = multimedia?.image_urls
    ? multimedia.image_urls.split(";").filter(Boolean)
    : [];
  const videos = extractValidItems(multimedia?.ae_video_dtos, rawVideoSchema, {
    method: "aliexpress.ds.product.get",
    field: "ae_video_dtos",
  });
  const videoUrl = videos[0]?.media_url ?? null;

  const { count: salesVolume, display: salesVolumeDisplay } = toBucketedCount(base.sales_count);
  const categoryId = base.category_id !== undefined ? String(base.category_id) : null;

  const firstSkuCurrency = skus[0]?.currency_code ?? targetCurrency;

  return {
    productId: String(base.product_id),
    title: base.subject ?? null,
    productUrl: null,
    imageUrls,
    videoUrl,
    categoryId,
    salePrice: toNumber(skus[0]?.sku_price),
    salePriceCurrency: skus.length > 0 ? firstSkuCurrency : null,
    targetSalePrice: toNumber(skus[0]?.offer_sale_price),
    targetSalePriceCurrency: skus.length > 0 ? firstSkuCurrency : null,
    reviewCount: toNumber(base.evaluation_count),
    avgRating: toNumber(base.avg_evaluation_rating),
    salesVolume,
    salesVolumeDisplay,
    skus: skus.map((sku) => ({
      skuId: sku.sku_id !== undefined ? String(sku.sku_id) : null,
      skuAttrs: sku.sku_attr ?? "",
      price: toNumber(sku.sku_price),
      offerSalePrice: toNumber(sku.offer_sale_price),
      currency: sku.currency_code ?? null,
    })),
  };
}

export function normalizeFreightOptions(raw: RawFreightResult, method: string): NormalizedFreightOption[] {
  const options = extractValidItems(raw.delivery_options, rawDeliveryOptionSchema, {
    method,
    field: "delivery_options",
  });
  return options.map((option) => ({
    code: option.code ?? null,
    company: option.company ?? null,
    shippingFeeFormatted: option.shipping_fee_format ?? null,
    shippingFeeMajor: toNumber(option.shipping_fee_cent),
    shippingFeeCurrency: option.shipping_fee_currency ?? null,
    freeShipping: option.free_shipping ?? null,
    deliveryDateDesc: option.delivery_date_desc ?? null,
    minDeliveryDays: toNumber(option.min_delivery_days),
    maxDeliveryDays: toNumber(option.max_delivery_days),
    shipFromCountry: option.ship_from_country ?? null,
    trackingAvailable: option.tracking ?? null,
  }));
}

export function normalizeTrackingLines(raw: RawTrackingResult, method: string): NormalizedTrackingLine[] {
  const lines = extractValidItems(raw.data?.tracking_detail_line_list, rawTrackingDetailLineSchema, {
    method,
    field: "tracking_detail_line_list",
  });
  return lines.map((line) => {
    const nodes = extractValidItems(line.detail_node_list, rawTrackingDetailNodeSchema, {
      method,
      field: "detail_node_list",
    });
    return {
      mailNo: line.mail_no ?? null,
      carrierName: line.carrier_name ?? null,
      etaTimestamp: toNumber(line.eta_time_stamps),
      events: nodes.map((node) => ({
        name: node.tracking_name ?? null,
        description: node.tracking_detail_desc ?? null,
        timestamp: toNumber(node.time_stamp),
      })),
    };
  });
}
