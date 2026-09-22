import { describe, expect, it } from "vitest";
import { CLASSIFIER_CONFIDENCE_THRESHOLD, decideClassification, type ClassifierResult } from "@/lib/catalog/classify-decision";

function result(overrides: Partial<ClassifierResult> = {}): ClassifierResult {
  return {
    material: "bamboo",
    is_suitable: true,
    reject_reason: null,
    variants: [],
    confidence: 0.95,
    ...overrides,
  };
}

describe("decideClassification", () => {
  it("routes to CANDIDATE when suitable, confident, and at least one variant matched", () => {
    expect(decideClassification(result(), 2)).toEqual({ status: "CANDIDATE", rejectReason: null });
  });

  it("routes to REVIEW when the classifier itself says it's unsuitable, preserving its reason", () => {
    const decision = decideClassification(result({ is_suitable: false, reject_reason: "plastic tees" }), 2);
    expect(decision).toEqual({ status: "REVIEW", rejectReason: "plastic tees" });
  });

  it("routes to REVIEW when confidence is below the threshold, even if suitable", () => {
    const decision = decideClassification(result({ confidence: CLASSIFIER_CONFIDENCE_THRESHOLD - 0.01 }), 2);
    expect(decision.status).toBe("REVIEW");
  });

  it("treats the threshold itself as confident enough (>=, not >)", () => {
    const decision = decideClassification(result({ confidence: CLASSIFIER_CONFIDENCE_THRESHOLD }), 1);
    expect(decision.status).toBe("CANDIDATE");
  });

  it("forces REVIEW when no returned sku_id matched a known SupplierVariant, regardless of suitability/confidence", () => {
    const decision = decideClassification(result({ is_suitable: true, confidence: 0.99 }), 0);
    expect(decision.status).toBe("REVIEW");
  });

  it("falls back to a synthesized reason when zero variants matched and the model gave none", () => {
    const decision = decideClassification(result({ reject_reason: null }), 0);
    expect(decision.rejectReason).toBe("Classifier returned no variants matching a known SKU");
  });

  it("preserves the model's own reason when zero variants matched but it still gave one", () => {
    const decision = decideClassification(result({ reject_reason: "not a golf tee at all" }), 0);
    expect(decision.rejectReason).toBe("not a golf tee at all");
  });
});
