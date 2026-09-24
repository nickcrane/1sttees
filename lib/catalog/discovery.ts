import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { toMinorUnits } from "./slug";

// Fixed page size rather than reading env.ALIEXPRESS_DISCOVERY_PAGES_PER_KEYWORD's
// sibling -- fixture files are recorded per (keyword, pageNo) at this size
// (see fixtureNameFor in lib/aliexpress/client.ts), so changing it would
// silently invalidate every recorded fixture.
const PAGE_SIZE = 20;

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
  const seedKeywords = await prisma.discoverySeedKeyword.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  const maxPages = env.ALIEXPRESS_DISCOVERY_PAGES_PER_KEYWORD;
  const seenProductIds = new Set<string>();
  let productsUpserted = 0;
  let productsFailed = 0;

  for (const { keyword } of seedKeywords) {
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      let products, totalCount;
      try {
        ({ products, totalCount } = await client.searchProducts({ keywords: keyword, pageNo, pageSize: PAGE_SIZE }));
      } catch (error) {
        // Covers both a genuine gateway failure and fixture mode running
        // out of recorded pages (a missing page N fixture throws) -- either
        // way, keep whatever earlier pages already found rather than
        // discarding this keyword's results entirely.
        logger.warn({ keyword, pageNo, error }, "discovery: keyword search failed, stopping pagination for this keyword");
        break;
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

      if (products.length < PAGE_SIZE || pageNo * PAGE_SIZE >= totalCount) break;
    }
  }

  const summary: DiscoveryRunSummary = {
    keywordsSearched: seedKeywords.length,
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
