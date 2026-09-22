import { describe, expect, it } from "vitest";
import { findValidationFailure, type FulfilmentItemCheck } from "@/lib/orders/validate-fulfilment";

function item(overrides: Partial<FulfilmentItemCheck> = {}): FulfilmentItemCheck {
  return {
    titleSnapshot: "Bamboo Tee",
    productStatus: "PUBLISHED",
    currentSupplierPriceMinor: 300,
    supplierCostMinorSnapshot: 300,
    ...overrides,
  };
}

describe("findValidationFailure", () => {
  it("returns null when every item is published and within drift tolerance", () => {
    expect(findValidationFailure([item()], 10)).toBeNull();
  });

  it("flags an item whose product is no longer published", () => {
    const result = findValidationFailure([item({ productStatus: "UNPUBLISHED" })], 10);
    expect(result).toContain("no longer available");
  });

  it("flags a supplier price rise past the tolerance", () => {
    // 300 -> 340 is a 13.3% rise, over a 10% tolerance
    const result = findValidationFailure([item({ currentSupplierPriceMinor: 340 })], 10);
    expect(result).toContain("moved");
    expect(result).toContain("13.3%");
  });

  it("allows a price move within tolerance", () => {
    // 300 -> 320 is a 6.7% rise, under a 10% tolerance
    expect(findValidationFailure([item({ currentSupplierPriceMinor: 320 })], 10)).toBeNull();
  });

  it("flags a price drop past the tolerance too, not just a rise", () => {
    // 300 -> 250 is a 16.7% drop
    const result = findValidationFailure([item({ currentSupplierPriceMinor: 250 })], 10);
    expect(result).toContain("moved");
  });

  it("skips the drift check when there's no snapshot price to compare against", () => {
    expect(findValidationFailure([item({ supplierCostMinorSnapshot: 0, currentSupplierPriceMinor: 500 })], 10)).toBeNull();
  });

  it("checks items in order and reports the first failure", () => {
    const items = [item({ titleSnapshot: "First", productStatus: "PUBLISHED" }), item({ titleSnapshot: "Second", productStatus: "UNPUBLISHED" })];
    expect(findValidationFailure(items, 10)).toContain("Second");
  });
});
