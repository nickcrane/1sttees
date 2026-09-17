import { describe, expect, it } from "vitest";
import {
  normalizeProductDetail,
  normalizeSearchProduct,
  rawProductDetailResultSchema,
  rawSearchProductSchema,
  type RawProductDetailResult,
} from "@/lib/aliexpress/schemas";

describe("normalizeSearchProduct", () => {
  it("normalizes a full search result, including protocol-relative URL and bucketed order count", () => {
    const raw = rawSearchProductSchema.parse({
      itemId: 1005006543210987,
      title: "Bamboo Golf Tees",
      itemUrl: "//www.aliexpress.com/item/1005006543210987.html",
      itemMainPic: "https://ae01.alicdn.com/kf/bamboo-tee-1.jpg",
      cateId: "66,200000123,200003655",
      targetSalePrice: "4.29",
      discount: "33%",
      evaluateRate: "96.5%",
      orders: "500+",
    });
    const normalized = normalizeSearchProduct(raw, "GBP");
    expect(normalized).toEqual({
      productId: "1005006543210987",
      title: "Bamboo Golf Tees",
      productUrl: "https://www.aliexpress.com/item/1005006543210987.html",
      mainImageUrl: "https://ae01.alicdn.com/kf/bamboo-tee-1.jpg",
      categoryId: "200003655",
      targetSalePrice: 4.29,
      targetSalePriceCurrency: "GBP",
      discountPct: 33,
      evaluateRatePct: 96.5,
      salesVolume: 500,
      salesVolumeDisplay: "500+",
    });
  });

  it("handles a missing/zero-volume product without throwing", () => {
    const raw = rawSearchProductSchema.parse({ itemId: 42 });
    const normalized = normalizeSearchProduct(raw, "GBP");
    expect(normalized.productId).toBe("42");
    expect(normalized.salesVolume).toBeNull();
    expect(normalized.salesVolumeDisplay).toBeNull();
  });

  it("leaves an already-absolute item URL untouched", () => {
    const raw = rawSearchProductSchema.parse({ itemId: 1, itemUrl: "https://example.com/item/1" });
    expect(normalizeSearchProduct(raw, "GBP").productUrl).toBe("https://example.com/item/1");
  });
});

describe("normalizeProductDetail", () => {
  it("normalizes a full detail result, splitting the semicolon-joined image list and taking the first SKU as representative", () => {
    const raw = rawProductDetailResultSchema.parse({
      ae_item_base_info_dto: {
        product_id: 1005006543210987,
        subject: "Natural Bamboo Golf Tees",
        sales_count: "500+",
        category_id: 200003655,
        evaluation_count: 128,
        avg_evaluation_rating: "4.8",
      },
      ae_item_sku_info_dtos: [
        { sku_id: 111, sku_attr: "14:200000led#83mm", sku_price: "6.99", offer_sale_price: "4.29", currency_code: "GBP" },
        { sku_id: 112, sku_attr: "14:200000led#70mm", sku_price: "5.99", offer_sale_price: "3.79", currency_code: "GBP" },
      ],
      ae_multimedia_info_dto: {
        image_urls: "https://a.jpg;https://b.jpg;https://c.jpg",
        ae_video_dtos: [],
      },
    });
    const normalized = normalizeProductDetail(raw, "GBP");
    expect(normalized.productId).toBe("1005006543210987");
    expect(normalized.imageUrls).toEqual(["https://a.jpg", "https://b.jpg", "https://c.jpg"]);
    expect(normalized.salePrice).toBe(6.99);
    expect(normalized.targetSalePrice).toBe(4.29);
    expect(normalized.reviewCount).toBe(128);
    expect(normalized.avgRating).toBe(4.8);
    expect(normalized.skus).toHaveLength(2);
    expect(normalized.skus[0]).toEqual({
      skuId: "111",
      skuAttrs: "14:200000led#83mm",
      price: 6.99,
      offerSalePrice: 4.29,
      currency: "GBP",
    });
  });

  it("throws a clear error when product_id is missing (schema drift, not silently wrong data)", () => {
    // Bypasses the Zod schema deliberately -- this exercises normalizeProductDetail's
    // own runtime guard, not Zod's (product_id is required by the schema, so a
    // response actually missing it would already fail schema parsing upstream).
    const raw = { ae_item_base_info_dto: { subject: "no id" } } as unknown as RawProductDetailResult;
    expect(() => normalizeProductDetail(raw, "GBP")).toThrow(/product_id/);
  });

  it("handles a single (non-array) sku DTO the same as an array of one", () => {
    const raw = rawProductDetailResultSchema.parse({
      ae_item_base_info_dto: { product_id: 1, subject: "single sku" },
      ae_item_sku_info_dtos: { sku_id: 1, sku_attr: "", sku_price: "1.00" },
    });
    const normalized = normalizeProductDetail(raw, "GBP");
    expect(normalized.skus).toHaveLength(1);
  });
});
