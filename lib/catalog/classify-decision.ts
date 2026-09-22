import { z } from "zod";

export const CLASSIFIER_CONFIDENCE_THRESHOLD = 0.8;

// Colours the storefront's variant selector renders as a controlled set
// (docs/product-flow.md) -- anything the supplier's own listing implies
// beyond this gets folded into "Other" by the classifier itself, not left
// as free text we'd have to sanitise later.
export const COLOUR_OPTIONS = ["Natural", "White", "Black", "Mixed", "Printed", "Other"] as const;

// Deliberately narrower than docs/product-flow.md's illustrative example
// schema, which also has the model echo back price_gbp/stock per variant.
// We already hold those authoritatively on SupplierVariant -- asking
// Claude to reproduce them risks a hallucinated number silently
// overriding real data for no benefit, so only sku_id (to map the answer
// back to a SupplierVariant) and the three selectors we can't derive
// ourselves are requested.
export const classifierVariantSchema = z.object({
  sku_id: z.string(),
  length_mm: z.number().int().positive().nullable(),
  colour: z.enum(COLOUR_OPTIONS).nullable(),
  pack_size: z.number().int().positive().nullable(),
});

export const classifierResultSchema = z.object({
  material: z.enum(["bamboo", "wood", "plastic", "mixed", "unknown"]),
  is_suitable: z.boolean(),
  reject_reason: z.string().nullable(),
  variants: z.array(classifierVariantSchema),
  confidence: z.number().min(0).max(1),
});
export type ClassifierResult = z.infer<typeof classifierResultSchema>;

export interface ClassificationDecision {
  status: "CANDIDATE" | "REVIEW";
  rejectReason: string | null;
}

/**
 * Routing rule from docs/product-flow.md Stage 2: is_suitable and
 * confidence >= threshold -> CANDIDATE; anything else -> REVIEW, never
 * silently dropped. Zero matched variants (every sku_id the model
 * returned failed to match a real SupplierVariant -- a mapping mismatch,
 * not a suitability judgement) forces REVIEW regardless of what the model
 * reported, since a CANDIDATE with nothing purchasable isn't a candidate.
 */
export function decideClassification(result: ClassifierResult, matchedVariantCount: number): ClassificationDecision {
  if (matchedVariantCount === 0) {
    return {
      status: "REVIEW",
      rejectReason: result.reject_reason ?? "Classifier returned no variants matching a known SKU",
    };
  }
  if (!result.is_suitable || result.confidence < CLASSIFIER_CONFIDENCE_THRESHOLD) {
    return { status: "REVIEW", rejectReason: result.reject_reason };
  }
  return { status: "CANDIDATE", rejectReason: result.reject_reason };
}
