import type { Product, SupplierProduct, SupplierVariant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { callStructured } from "@/lib/llm/client";
import { landedCostConfigFromEnv } from "@/lib/pricing/config";
import { previewPricing } from "@/lib/pricing/calculate";
import { getApplicablePriceRule } from "./pricing-rules";
import { variantTitle } from "./variant-title";
import { slugify } from "./slug";
import { classifierResultSchema, decideClassification, type ClassifierResult } from "./classify-decision";

const SYSTEM_PROMPT = `You classify supplier products for 1st Tees, a UK e-commerce store selling golf tees, sourced via dropshipping from AliExpress.

You're given a product's title and its raw AliExpress SKU list (sku_id plus a messy, inconsistent sku_attr string -- e.g. "14:200000led#83mm" or "Color: 70mm-100pcs Natural"). Decide whether the product is a genuine, sellable golf tee, and normalise every SKU onto three clean selectors.

Suitability: is_suitable is false for plastic tees, golf accessories that aren't tees themselves, or bundles that mix tees with other kit (gloves, balls, bags). Only real wooden/bamboo (or clearly tee-shaped, material-unclear) tee products are suitable.

Material: bamboo, wood, plastic, mixed, or unknown -- infer from the title and sku_attr text; don't guess beyond what's stated or strongly implied.

Normalisation rules, applied per SKU:
- length_mm: millimetres, converted from whatever unit appears (2¾" -> 70, 3¼" -> 83). Null if no length is stated for that SKU.
- colour: exactly one of Natural, White, Black, Mixed, Printed, Other. Null if no colour is stated.
- pack_size: an integer count of tees in the pack. Null if no pack size is stated.

confidence: your own confidence (0-1) that material and is_suitable are both correct. Be honest -- a low-confidence call routes to a human review queue rather than blocking the product, so there's no cost to saying you're unsure.

reject_reason: a short, specific reason when is_suitable is false (e.g. "plastic tees, not wood/bamboo" or "bundle includes a golf glove"). Null when is_suitable is true.

Every sku_id you were given must appear exactly once in your variants array -- don't invent, merge, or drop any.`;

function buildPrompt(title: string, variants: Array<{ aeSkuId: string; skuAttrs: string }>): string {
  const variantLines = variants.map((v) => `- sku_id: ${v.aeSkuId}, sku_attr: "${v.skuAttrs}"`).join("\n");
  return `Product title: ${title}\n\nVariants:\n${variantLines}`;
}

async function classifyWithClaude(
  title: string,
  variants: Array<{ aeSkuId: string; skuAttrs: string }>
): Promise<ClassifierResult> {
  return callStructured({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(title, variants),
    schema: classifierResultSchema,
    toolName: "classify_product",
    toolDescription: "Records the material classification, suitability, and per-variant normalisation for one supplier product.",
  });
}

export interface ClassifyRunSummary {
  supplierProductsConsidered: number;
  classified: number;
  skippedCurated: number;
  failed: number;
}

/**
 * Stage 2: classifies every ACTIVE SupplierProduct that isn't already
 * past the classifier's own stage of the pipeline. An admin's APPROVED/
 * REJECTED/PARKED/PUBLISHED/RETIRED call on a Product is never
 * overwritten by a re-classification -- docs/product-flow.md's "re-run
 * both passes on every fetch" (cost is negligible at this scale) only
 * ever applies to a product still sitting at CANDIDATE/REVIEW.
 *
 * A single product failing (a malformed classifier response, an
 * Anthropic API error) is logged and skipped, not fatal to the run --
 * same rationale as lib/catalog/discovery.ts.
 */
export async function classifyDiscoveredProducts(): Promise<ClassifyRunSummary> {
  const supplierProducts = await prisma.supplierProduct.findMany({
    where: { status: "ACTIVE" },
    include: { variants: true },
  });

  let classified = 0;
  let skippedCurated = 0;
  let failed = 0;

  for (const supplierProduct of supplierProducts) {
    try {
      const existingProduct = await findLinkedProduct(supplierProduct.id);
      if (existingProduct && existingProduct.status !== "CANDIDATE" && existingProduct.status !== "REVIEW") {
        skippedCurated++;
        continue;
      }
      if (await classifyAndUpsertProduct(supplierProduct, existingProduct)) classified++;
    } catch (error) {
      failed++;
      logger.warn({ supplierProductId: supplierProduct.id, error }, "classify: failed to classify product, skipping");
    }
  }

  const summary: ClassifyRunSummary = { supplierProductsConsidered: supplierProducts.length, classified, skippedCurated, failed };
  logger.info(summary, "classify: run complete");
  return summary;
}

async function findLinkedProduct(supplierProductId: string): Promise<Product | null> {
  return prisma.product.findUnique({ where: { supplierProductId } });
}

async function classifyAndUpsertProduct(
  supplierProduct: SupplierProduct & { variants: SupplierVariant[] },
  existingProduct: Product | null
): Promise<boolean> {
  if (supplierProduct.variants.length === 0) {
    logger.warn({ supplierProductId: supplierProduct.id }, "classify: supplier product has no variants, skipping");
    return false;
  }

  const result = await classifyWithClaude(
    supplierProduct.title,
    supplierProduct.variants.map((v) => ({ aeSkuId: v.aeSkuId, skuAttrs: v.skuAttrs }))
  );

  const variantBySkuId = new Map(supplierProduct.variants.map((v) => [v.aeSkuId, v]));
  const matchedVariants = result.variants.filter((v) => variantBySkuId.has(v.sku_id));
  if (matchedVariants.length < result.variants.length) {
    logger.warn(
      { supplierProductId: supplierProduct.id, unmatchedCount: result.variants.length - matchedVariants.length },
      "classify: some returned sku_ids didn't match a known SupplierVariant, dropping them"
    );
  }

  const decision = decideClassification(result, matchedVariants.length);
  const productData = {
    material: result.material,
    classifierConfidence: result.confidence,
    rejectReason: decision.rejectReason,
    status: decision.status,
  };

  const product = existingProduct
    ? await prisma.product.update({ where: { id: existingProduct.id }, data: productData })
    : await prisma.product.create({
        data: {
          slug: await uniqueSlugFor(supplierProduct.title),
          title: supplierProduct.title,
          description: supplierProduct.title,
          images: supplierProduct.imageUrls,
          supplierProductId: supplierProduct.id,
          ...productData,
        },
      });

  if (matchedVariants.length === 0) return true;

  const rule = await getApplicablePriceRule(product.id);
  const landedCostConfig = landedCostConfigFromEnv();

  for (const variant of matchedVariants) {
    const supplierVariant = variantBySkuId.get(variant.sku_id);
    if (!supplierVariant) continue;

    // No freight quote yet -- Stage 1 doesn't fetch/store shipping cost
    // (see lib/catalog/discovery.ts), so this treats shipping as free for
    // the initial candidate price. A real landed-cost figure (including
    // shipping) matters for an admin's approve/reject call in Stage 3's
    // margin-pricing view -- refine there rather than adding a freight
    // call to every classification pass.
    const pricing = previewPricing(
      { supplierPriceMinor: supplierVariant.supplierPriceMinor, supplierShippingMinor: 0 },
      landedCostConfig,
      rule
    );

    const data = {
      title: variantTitle(supplierVariant.skuAttrs),
      priceMinor: pricing.retailPriceMinor,
      currency: supplierVariant.currency,
      images: supplierProduct.imageUrls,
      lengthMm: variant.length_mm,
      colour: variant.colour,
      packSize: variant.pack_size,
    };
    await prisma.productVariant.upsert({
      where: { supplierVariantId: supplierVariant.id },
      create: { productId: product.id, supplierVariantId: supplierVariant.id, ...data },
      update: data,
    });
  }

  return true;
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
