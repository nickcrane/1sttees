import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { toMinorUnits } from "./slug";

// Stage 1 seed list, per docs/product-flow.md -- there's no material filter
// in the DS API, so "wooden and bamboo" is inferred later (Stage 2's
// classifier); this just casts a wide net. Add to this list as gaps in
// coverage appear (the doc calls this out explicitly).
export const DISCOVERY_SEED_KEYWORDS = [
  "bamboo golf tees",
  "wooden golf tees",
  "wood golf tee 70mm",
  "bamboo tee 83mm",
  "natural wood tees bulk",
  "golf tees biodegradable",
];

export interface DiscoveryRunSummary {
  keywordsSearched: number;
  productsFound: number;
  productsUpserted: number;
  productsFailed: number;
}

/**
 * Stage 1 of the catalog discovery pipeline: search every seed keyword,
 * dedupe the product ids found, and fetch+store each one's full detail as
 * a SupplierProduct/SupplierVariant row. Deliberately stops at raw
 * supplier data -- classifying it into a merchandised Product (Stage 2) is
 * a separate pass, run over whatever this leaves in the table.
 *
 * A single keyword or product failing (a schema-drift error, a gateway
 * timeout) is logged and skipped rather than aborting the whole run --
 * this is a nightly batch job over a few hundred products; one bad item
 * shouldn't cost the rest their nightly refresh.
 */
export async function runDiscovery(client: AliExpressClient = new AliExpressClient()): Promise<DiscoveryRunSummary> {
  const seenProductIds = new Set<string>();
  let productsUpserted = 0;
  let productsFailed = 0;

  for (const keyword of DISCOVERY_SEED_KEYWORDS) {
    let products;
    try {
      ({ products } = await client.searchProducts({ keywords: keyword }));
    } catch (error) {
      logger.warn({ keyword, error }, "discovery: keyword search failed, skipping");
      continue;
    }

    for (const product of products) {
      if (seenProductIds.has(product.productId)) continue;
      seenProductIds.add(product.productId);

      try {
        await upsertSupplierProduct(client, product.productId, keyword);
        productsUpserted++;
      } catch (error) {
        productsFailed++;
        logger.warn({ productId: product.productId, keyword, error }, "discovery: failed to fetch/store product, skipping");
      }
    }
  }

  const summary: DiscoveryRunSummary = {
    keywordsSearched: DISCOVERY_SEED_KEYWORDS.length,
    productsFound: seenProductIds.size,
    productsUpserted,
    productsFailed,
  };
  logger.info(summary, "discovery: run complete");
  return summary;
}

async function upsertSupplierProduct(client: AliExpressClient, aeProductId: string, discoverySource: string): Promise<void> {
  const { product, raw } = await client.getProductDetailWithRaw(aeProductId);
  // aliexpress.ds.product.get's response has no URL field at all
  // (confirmed: normalizeProductDetail always returns productUrl: null --
  // that's only ever populated from a *search* result's itemUrl). The
  // product page URL is a fixed, well-known pattern keyed on the id
  // itself, so build it directly rather than storing a field that would
  // otherwise never get set by this code path.
  const supplierUrl = `https://www.aliexpress.com/item/${aeProductId}.html`;

  const supplierProduct = await prisma.supplierProduct.upsert({
    where: { aeProductId },
    create: {
      aeProductId,
      title: product.title ?? `AliExpress product ${aeProductId}`,
      raw: raw as unknown as Prisma.InputJsonValue,
      imageUrls: product.imageUrls,
      supplierUrl,
      discoverySource,
      lastSyncedAt: new Date(),
    },
    update: {
      title: product.title ?? `AliExpress product ${aeProductId}`,
      raw: raw as unknown as Prisma.InputJsonValue,
      imageUrls: product.imageUrls,
      supplierUrl,
      lastSyncedAt: new Date(),
      // discoverySource intentionally left alone on a re-sync -- keep
      // whichever keyword found the product first, not whichever
      // happened to run last.
    },
  });

  for (const sku of product.skus) {
    if (!sku.skuId || sku.price === null) {
      logger.warn({ aeProductId, sku }, "discovery: skipping supplier SKU with no id or no price");
      continue;
    }
    const data = {
      skuAttrs: sku.skuAttrs,
      supplierPriceMinor: toMinorUnits(sku.offerSalePrice ?? sku.price),
      currency: sku.currency ?? product.targetSalePriceCurrency ?? "GBP",
    };
    await prisma.supplierVariant.upsert({
      where: { supplierProductId_aeSkuId: { supplierProductId: supplierProduct.id, aeSkuId: sku.skuId } },
      create: { supplierProductId: supplierProduct.id, aeSkuId: sku.skuId, ...data },
      update: data,
    });
  }
}
