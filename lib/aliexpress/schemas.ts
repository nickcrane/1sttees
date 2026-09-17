import { z } from "zod";

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
    products: z.union([z.array(rawSearchProductSchema), rawSearchProductSchema]).optional(),
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
    ae_item_sku_info_dtos: z.union([z.array(rawSkuSchema), rawSkuSchema]).optional(),
    ae_multimedia_info_dto: z
      .object({
        image_urls: z.string().optional(), // semicolon-separated, not an array -- confirmed live
        ae_video_dtos: z.union([z.array(z.object({ media_url: z.string().optional() }).passthrough()), z.object({ media_url: z.string().optional() }).passthrough()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type RawProductDetailResult = z.infer<typeof rawProductDetailResultSchema>;

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

export function normalizeProductDetail(raw: RawProductDetailResult, targetCurrency: string): NormalizedProduct {
  const base = raw.ae_item_base_info_dto;
  if (!base || base.product_id === undefined) {
    throw new Error("product detail payload is missing ae_item_base_info_dto.product_id");
  }
  const skusRaw = raw.ae_item_sku_info_dtos;
  const skus = skusRaw === undefined ? [] : Array.isArray(skusRaw) ? skusRaw : [skusRaw];

  const multimedia = raw.ae_multimedia_info_dto;
  const imageUrls = multimedia?.image_urls
    ? multimedia.image_urls.split(";").filter(Boolean)
    : [];
  const videosRaw = multimedia?.ae_video_dtos;
  const videos = videosRaw === undefined ? [] : Array.isArray(videosRaw) ? videosRaw : [videosRaw];
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
