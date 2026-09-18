import type { Prisma, Product, ProductVariant, SupplierProduct } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { NormalizedProduct } from "@/lib/aliexpress/schemas";
import { landedCostConfigFromEnv } from "@/lib/pricing/config";
import { previewPricing } from "@/lib/pricing/calculate";
import { getApplicablePriceRule } from "./pricing-rules";
import { parseAeProductId } from "./parse-product-id";
import { slugify, toMinorUnits } from "./slug";

export class ProductImportError extends Error {}

export interface ImportedVariant {
  productVariant: ProductVariant;
  belowFloorMargin: boolean;
}

export interface ImportResult {
  supplierProduct: SupplierProduct;
  product: Product;
  variants: ImportedVariant[];
}

/**
 * End-to-end: fetch from AliExpress, upsert SupplierProduct/SupplierVariant
 * (the raw supplier-side record), then upsert a merchandised Product/
 * ProductVariant per SKU with a price computed by the pricing engine.
 * Re-running with the same product id is idempotent -- upserts throughout,
 * safe to use for both first import and manual refresh.
 *
 * A variant whose computed price would fall below the applicable price
 * rule's floor margin is created but left unpublished-equivalent (caller
 * decides what "unpublished" means for a variant -- see the DRAFT-if-any-
 * variant-violates-floor decision in importAliExpressProduct's status
 * logic) rather than silently absorbing the margin hit -- matches the
 * spec's "don't silently reprice" rule for the sync job, applied here too
 * since the failure mode (an underpriced listing going live) is the same.
 */
export async function importAliExpressProduct(
  productIdOrUrl: string,
  client: AliExpressClient = new AliExpressClient()
): Promise<ImportResult> {
  const aeProductId = parseAeProductId(productIdOrUrl);
  if (!aeProductId) {
    throw new ProductImportError(`Couldn't find a product id in "${productIdOrUrl}"`);
  }

  const { product: normalized, raw } = await client.getProductDetailWithRaw(aeProductId);
  if (normalized.skus.length === 0) {
    throw new ProductImportError(`Product ${aeProductId} has no purchasable SKUs -- nothing to import`);
  }

  const supplierProduct = await upsertSupplierProduct(aeProductId, normalized, raw as unknown as Prisma.InputJsonValue);
  const supplierShippingMinor = await estimateShippingMinor(client, aeProductId, normalized);
  const rule = await getApplicablePriceRule();
  const landedCostConfig = landedCostConfigFromEnv();

  const variants: ImportedVariant[] = [];
  for (const sku of normalized.skus) {
    if (!sku.skuId || sku.price === null) {
      logger.warn({ aeProductId, sku }, "skipping supplier SKU with no id or no price");
      continue;
    }

    const supplierVariant = await prisma.supplierVariant.upsert({
      where: { supplierProductId_aeSkuId: { supplierProductId: supplierProduct.id, aeSkuId: sku.skuId } },
      create: {
        supplierProductId: supplierProduct.id,
        aeSkuId: sku.skuId,
        skuAttrs: sku.skuAttrs,
        supplierPriceMinor: toMinorUnits(sku.price),
        currency: sku.currency ?? "GBP",
      },
      update: {
        skuAttrs: sku.skuAttrs,
        supplierPriceMinor: toMinorUnits(sku.price),
        currency: sku.currency ?? "GBP",
      },
    });

    const pricing = previewPricing(
      { supplierPriceMinor: supplierVariant.supplierPriceMinor, supplierShippingMinor },
      landedCostConfig,
      rule
    );

    const slug = await uniqueSlugFor(normalized.title ?? `product-${aeProductId}`);
    const product = await upsertMerchandisedProduct(supplierProduct, normalized, slug, variants.length === 0);

    const productVariant = await prisma.productVariant.upsert({
      where: { supplierVariantId: supplierVariant.id },
      create: {
        productId: product.id,
        supplierVariantId: supplierVariant.id,
        title: variantTitle(sku.skuAttrs),
        priceMinor: pricing.retailPriceMinor,
        currency: "GBP",
        images: normalized.imageUrls,
      },
      update: {
        title: variantTitle(sku.skuAttrs),
        priceMinor: pricing.retailPriceMinor,
      },
    });

    variants.push({ productVariant, belowFloorMargin: pricing.belowFloorMargin });
  }

  if (variants.length === 0) {
    throw new ProductImportError(`Product ${aeProductId} had no importable SKUs (missing id or price on all of them)`);
  }

  const product = await prisma.product.findUniqueOrThrow({ where: { id: variants[0].productVariant.productId } });
  const anyBelowFloor = variants.some((v) => v.belowFloorMargin);
  const finalStatus = anyBelowFloor ? "DRAFT" : "PUBLISHED";
  const updatedProduct = await prisma.product.update({ where: { id: product.id }, data: { status: finalStatus } });

  return { supplierProduct, product: updatedProduct, variants };
}

async function upsertSupplierProduct(
  aeProductId: string,
  normalized: NormalizedProduct,
  raw: Prisma.InputJsonValue
): Promise<SupplierProduct> {
  const data = {
    title: normalized.title ?? `AliExpress product ${aeProductId}`,
    raw,
    imageUrls: normalized.imageUrls,
    supplierUrl: normalized.productUrl ?? undefined,
    status: "ACTIVE" as const,
    lastSyncedAt: new Date(),
  };
  return prisma.supplierProduct.upsert({
    where: { aeProductId },
    create: { aeProductId, ...data },
    update: data,
  });
}

async function upsertMerchandisedProduct(
  supplierProduct: SupplierProduct,
  normalized: NormalizedProduct,
  slug: string,
  isFirstVariant: boolean
): Promise<Product> {
  // Every variant of one supplier product belongs to the same merchandised
  // Product -- look for one already linked via any of this supplier
  // product's supplier variants before creating a new one, so importing a
  // multi-SKU product doesn't create a Product per SKU.
  const existing = await prisma.product.findFirst({
    where: { variants: { some: { supplierVariant: { supplierProductId: supplierProduct.id } } } },
  });
  if (existing) return existing;

  if (!isFirstVariant) {
    // Shouldn't happen (the first SKU processed would have created it),
    // but fail loudly rather than silently creating a duplicate Product.
    throw new ProductImportError("Expected a merchandised Product to already exist for this supplier product");
  }

  return prisma.product.create({
    data: {
      slug,
      title: normalized.title ?? `AliExpress product ${supplierProduct.aeProductId}`,
      description: normalized.title ?? "",
      images: normalized.imageUrls,
      status: "DRAFT",
    },
  });
}

async function uniqueSlugFor(title: string): Promise<string> {
  const base = slugify(title) || "product";
  let candidate = base;
  let suffix = 1;
  while (await prisma.product.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export function variantTitle(skuAttrs: string): string {
  // sku_attr is `;`-separated property groups, each optionally carrying a
  // human-readable label after a `#` (confirmed live in both shapes: golf
  // tee SKUs are a single group, "14:200000led#83mm"; the test-account
  // T-shirt SKUs have several, e.g.
  // "5:4182;14:1254#tianlan;200007763:201441035" -- only the middle group
  // has a label). Pull the label out of every group that has one and join
  // them; a group with no label (a raw property-id pair, like the third
  // one above) contributes nothing rather than polluting the title.
  if (!skuAttrs) return "Default";
  const labels = skuAttrs
    .split(";")
    .map((group) => group.split("#")[1])
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(" / ") : skuAttrs;
}

/**
 * One freight quote for the product's first SKU, reused as an estimate for
 * every variant -- shipping cost varies little between SKUs of the same
 * product to the same destination, and quoting per-SKU during import would
 * multiply the API calls (and import time) for no real accuracy gain.
 * Failure here doesn't block import: falls back to 0 (logged), since an
 * admin can always refine pricing manually afterward.
 */
async function estimateShippingMinor(
  client: AliExpressClient,
  aeProductId: string,
  normalized: NormalizedProduct
): Promise<number> {
  const firstSkuId = normalized.skus[0]?.skuId;
  if (!firstSkuId) return 0;
  try {
    const options = await client.getFreightQuote({ productId: aeProductId, skuId: firstSkuId });
    const cheapest = options.reduce<number | null>((min, option) => {
      if (option.shippingFeeMajor === null) return min;
      return min === null ? option.shippingFeeMajor : Math.min(min, option.shippingFeeMajor);
    }, null);
    return cheapest !== null ? toMinorUnits(cheapest) : 0;
  } catch (error) {
    logger.warn({ aeProductId, error }, "freight quote failed during import, defaulting shipping cost to 0");
    return 0;
  }
}
