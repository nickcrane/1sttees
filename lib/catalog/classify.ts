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
import { mineRejectFeedback, titleMatchesFlaggedTerm, type RejectExample, type RejectFeedback } from "./reject-feedback";

const BASE_SYSTEM_PROMPT = `You classify supplier products for 1st Tees, a UK e-commerce store selling golf tees, sourced via dropshipping from AliExpress.

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

// Appends real admin reject decisions (lib/catalog/reject-feedback.ts) as
// few-shot examples when there's history to draw on -- this store's own
// judgment calls carry more weight than the general rule above, and cost
// nothing to include since they're built once per run, not per product.
// No written reason to hand over (admins aren't asked for one), so each
// example is the same kind of raw metadata the classifier already
// reasons over per product -- title, its own past material guess, and
// the supplier's sku_attrs -- tagged as rejected, letting it infer the
// pattern itself rather than being told one.
function buildSystemPrompt(examples: RejectExample[]): string {
  if (examples.length === 0) return BASE_SYSTEM_PROMPT;
  const examplesBlock = examples
    .map((e) => {
      const material = e.material ? `material guess: ${e.material}` : "material guess: unknown";
      const attrs = e.skuAttrs.length > 0 ? `sku_attrs: ${e.skuAttrs.map((a) => `"${a}"`).join(", ")}` : "sku_attrs: none recorded";
      return `- title: "${e.title}", ${material}, ${attrs}`;
    })
    .join("\n");
  return `${BASE_SYSTEM_PROMPT}

An admin rejected each of these real products (no written reason given -- use your own judgment on what they have in common and why they weren't suitable):
${examplesBlock}`;
}

function buildPrompt(title: string, variants: Array<{ aeSkuId: string; skuAttrs: string }>): string {
  const variantLines = variants.map((v) => `- sku_id: ${v.aeSkuId}, sku_attr: "${v.skuAttrs}"`).join("\n");
  return `Product title: ${title}\n\nVariants:\n${variantLines}`;
}

async function classifyWithClaude(
  systemPrompt: string,
  title: string,
  variants: Array<{ aeSkuId: string; skuAttrs: string }>
): Promise<ClassifierResult> {
  return callStructured({
    system: systemPrompt,
    prompt: buildPrompt(title, variants),
    schema: classifierResultSchema,
    toolName: "classify_product",
    toolDescription: "Records the material classification, suitability, and per-variant normalisation for one supplier product.",
  });
}

// Rejects only ever happen via an explicit admin action (classify.ts's
// own routing never sets REJECTED, only CANDIDATE/REVIEW -- see
// classify-decision.ts), so every REJECTED row here is genuine admin
// signal, not a classifier guess. Bounded fetches (100/300 rows): this
// store's whole catalog is a few hundred products, and mineRejectFeedback
// only needs enough of each side to find terms that repeat. sku_attrs
// capped at 5 variants/product -- enough to show the pattern without
// letting one bulk-variant listing bloat every classify call's prompt.
async function loadRejectFeedback(): Promise<RejectFeedback> {
  const [rejectedRows, accepted] = await Promise.all([
    prisma.product.findMany({
      where: { status: "REJECTED" },
      select: {
        title: true,
        material: true,
        supplierProduct: { select: { variants: { select: { skuAttrs: true }, take: 5 } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.product.findMany({
      where: { status: { in: ["CANDIDATE", "APPROVED", "PUBLISHED"] } },
      select: { title: true },
      take: 300,
    }),
  ]);
  const rejected = rejectedRows.map((p) => ({
    title: p.title,
    material: p.material,
    skuAttrs: p.supplierProduct?.variants.map((v) => v.skuAttrs) ?? [],
  }));
  return mineRejectFeedback(rejected, accepted);
}

export interface ClassifyRunSummary {
  supplierProductsConsidered: number;
  classified: number;
  skippedCurated: number;
  failed: number;
  /** CANDIDATE decisions the reject-feedback rule (lib/catalog/reject-feedback.ts) downgraded to REVIEW -- not counted separately in `classified`, just a visible signal the rule is doing something. */
  ruleFlagged: number;
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

  // Fetched/built once per run, not per product -- an admin's rejects
  // don't change mid-run, and this keeps the per-product cost to exactly
  // one Claude call, same as before this feedback loop existed.
  const feedback = await loadRejectFeedback();
  const systemPrompt = buildSystemPrompt(feedback.examples);

  let classified = 0;
  let skippedCurated = 0;
  let failed = 0;
  let ruleFlagged = 0;

  for (const supplierProduct of supplierProducts) {
    try {
      const existingProduct = await findLinkedProduct(supplierProduct.id);
      if (existingProduct && existingProduct.status !== "CANDIDATE" && existingProduct.status !== "REVIEW") {
        skippedCurated++;
        continue;
      }
      const outcome = await classifyAndUpsertProduct(supplierProduct, existingProduct, systemPrompt, feedback.flaggedTerms);
      if (outcome.processed) classified++;
      if (outcome.ruleFlagged) ruleFlagged++;
    } catch (error) {
      failed++;
      logger.warn({ supplierProductId: supplierProduct.id, error }, "classify: failed to classify product, skipping");
    }
  }

  const summary: ClassifyRunSummary = {
    supplierProductsConsidered: supplierProducts.length,
    classified,
    skippedCurated,
    failed,
    ruleFlagged,
  };
  logger.info(summary, "classify: run complete");
  return summary;
}

async function findLinkedProduct(supplierProductId: string): Promise<Product | null> {
  return prisma.product.findUnique({ where: { supplierProductId } });
}

interface ClassifyOutcome {
  processed: boolean;
  ruleFlagged: boolean;
}

async function classifyAndUpsertProduct(
  supplierProduct: SupplierProduct & { variants: SupplierVariant[] },
  existingProduct: Product | null,
  systemPrompt: string,
  flaggedTerms: string[]
): Promise<ClassifyOutcome> {
  if (supplierProduct.variants.length === 0) {
    logger.warn({ supplierProductId: supplierProduct.id }, "classify: supplier product has no variants, skipping");
    return { processed: false, ruleFlagged: false };
  }

  const result = await classifyWithClaude(
    systemPrompt,
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

  const classifierDecision = decideClassification(result, matchedVariants.length);

  // The rule-based pre-filter (lib/catalog/reject-feedback.ts) only ever
  // downgrades CANDIDATE -> REVIEW, never decides REJECTED itself -- it's
  // a second, cheaper opinion the classifier already agreed to sell this,
  // flagging a term that's historically only ever shown up in things an
  // admin rejected. A human still makes the final call, same as every
  // other REVIEW row.
  const flaggedTerm = classifierDecision.status === "CANDIDATE" ? titleMatchesFlaggedTerm(supplierProduct.title, flaggedTerms) : null;
  const decision = flaggedTerm
    ? {
        status: "REVIEW" as const,
        rejectReason: `Candidate rule: title contains "${flaggedTerm}", a term that's only ever appeared in past admin rejections, never an accepted product. Classifier itself judged this suitable -- confirm or reject.`,
      }
    : classifierDecision;

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

  if (matchedVariants.length === 0) return { processed: true, ruleFlagged: Boolean(flaggedTerm) };

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

  return { processed: true, ruleFlagged: Boolean(flaggedTerm) };
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
