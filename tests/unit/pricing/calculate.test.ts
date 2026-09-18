import { describe, expect, it } from "vitest";
import {
  applyRounding,
  calculateLandedCostMinor,
  calculateRetailPrice,
  previewPricing,
  type LandedCostConfig,
  type PriceRuleInputs,
} from "@/lib/pricing/calculate";

const CONFIG: LandedCostConfig = {
  fxBufferPct: 3,
  paymentProcessingPct: 1.5,
  paymentProcessingFixedMinor: 20,
  returnsReservePct: 2,
};

const RULE: PriceRuleInputs = {
  costMultiplier: 2.5,
  fixedUpliftMinor: 0,
  floorMarginPct: 20,
  roundingRule: "PSYCHOLOGICAL_99",
  maxPriceMinor: null,
};

describe("calculateLandedCostMinor", () => {
  it("sums item + shipping, FX-buffered, plus payment processing and returns reserve", () => {
    // item 300 + shipping 100 = 400; fx-buffered 400*1.03 = 412
    // payment processing: 412*0.015 + 20 = 26.18 -> rounds with the rest
    // returns reserve: 412*0.02 = 8.24
    // total = 412 + 26.18 + 8.24 = 446.42 -> rounds to 446
    const result = calculateLandedCostMinor({ supplierPriceMinor: 300, supplierShippingMinor: 100 }, CONFIG);
    expect(result).toBe(446);
  });

  it("is zero-shipping safe", () => {
    const result = calculateLandedCostMinor({ supplierPriceMinor: 100, supplierShippingMinor: 0 }, CONFIG);
    expect(result).toBeGreaterThan(100);
  });
});

describe("applyRounding", () => {
  it("rounds up to the next .99 when the price isn't already one", () => {
    expect(applyRounding(1250, "PSYCHOLOGICAL_99")).toBe(1299);
  });

  it("leaves a price that's already X.99 alone", () => {
    expect(applyRounding(1299, "PSYCHOLOGICAL_99")).toBe(1299);
  });

  it("rounds a price just above X.99 up to the next pound's .99, not down", () => {
    expect(applyRounding(1300, "PSYCHOLOGICAL_99")).toBe(1399);
  });

  it("does nothing under NONE except round to the nearest integer", () => {
    expect(applyRounding(1250.4, "NONE")).toBe(1250);
  });
});

describe("calculateRetailPrice", () => {
  it("applies the cost multiplier, rounds, and computes margin as a % of retail price", () => {
    const result = calculateRetailPrice(500, RULE);
    // 500 * 2.5 = 1250 -> rounded to 1299
    expect(result.retailPriceMinor).toBe(1299);
    expect(result.marginMinor).toBe(1299 - 500);
    expect(result.marginPct).toBeCloseTo((799 / 1299) * 100, 5);
    expect(result.belowFloorMargin).toBe(false);
    expect(result.cappedByMaxPrice).toBe(false);
  });

  it("flags belowFloorMargin when the computed margin doesn't clear the rule's floor", () => {
    const thinRule: PriceRuleInputs = { ...RULE, costMultiplier: 1.05, floorMarginPct: 20 };
    const result = calculateRetailPrice(1000, thinRule);
    expect(result.marginPct).toBeLessThan(20);
    expect(result.belowFloorMargin).toBe(true);
  });

  it("caps at maxPriceMinor and flags cappedByMaxPrice, recomputing margin at the capped price", () => {
    const cappedRule: PriceRuleInputs = { ...RULE, costMultiplier: 5, maxPriceMinor: 1500 };
    const result = calculateRetailPrice(500, cappedRule);
    // 500 * 5 = 2500 -> would round to 2599, but capped to 1500
    expect(result.retailPriceMinor).toBe(1500);
    expect(result.cappedByMaxPrice).toBe(true);
    expect(result.marginMinor).toBe(1000);
  });

  it("applies fixedUpliftMinor before rounding", () => {
    const result = calculateRetailPrice(500, { ...RULE, fixedUpliftMinor: 200 });
    // (500 * 2.5) + 200 = 1450 -> rounds to 1499
    expect(result.retailPriceMinor).toBe(1499);
  });
});

describe("previewPricing", () => {
  it("combines landed cost and retail price calculation end to end", () => {
    const result = previewPricing({ supplierPriceMinor: 300, supplierShippingMinor: 100 }, CONFIG, RULE);
    expect(result.landedCostMinor).toBe(446);
    expect(result.retailPriceMinor).toBe(applyRounding(446 * 2.5, "PSYCHOLOGICAL_99"));
    expect(result.supplierPriceMinor).toBe(300);
  });
});
