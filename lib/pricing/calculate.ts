/**
 * Landed cost + retail pricing, all in integer minor units (pence). Every
 * function here is pure -- no DB, no env access -- so tests don't need
 * either; callers (the preview API, the import pipeline) pass in whatever
 * config/rule applies.
 */

export interface LandedCostConfig {
  /** Buffer against AliExpress's own USD->GBP conversion drifting between
   * caching a price and actually placing the order. Applied regardless of
   * the currency the supplier price arrived in. */
  fxBufferPct: number;
  paymentProcessingPct: number;
  paymentProcessingFixedMinor: number;
  returnsReservePct: number;
}

export interface LandedCostInputs {
  supplierPriceMinor: number;
  supplierShippingMinor: number;
}

/**
 * Landed cost = item + shipping, buffered for FX drift, plus the payment
 * processing fee and returns reserve.
 *
 * Simplification worth being explicit about: `paymentProcessingPct` is
 * applied to the FX-buffered item+shipping subtotal, not to the eventual
 * retail price the customer actually pays a processing fee on. The true
 * fee scales with the final charge, which depends on the margin multiplier
 * applied on *top* of this landed cost -- solving that properly is a
 * circular (retail depends on landed cost depends on a fee that depends on
 * retail) calculation the mission brief's plain-English formula doesn't
 * ask for ("Landed cost = A + B + C + D + E"). This treats it as one more
 * additive landed-cost component, matching that formula, at the cost of
 * slightly underestimating the true fee. Revisit if margins end up
 * measurably tighter than this predicts.
 */
export function calculateLandedCostMinor(inputs: LandedCostInputs, config: LandedCostConfig): number {
  const subtotal = inputs.supplierPriceMinor + inputs.supplierShippingMinor;
  const fxBuffered = subtotal * (1 + config.fxBufferPct / 100);
  const paymentProcessing = fxBuffered * (config.paymentProcessingPct / 100) + config.paymentProcessingFixedMinor;
  const returnsReserve = fxBuffered * (config.returnsReservePct / 100);
  return Math.round(fxBuffered + paymentProcessing + returnsReserve);
}

export type RoundingRule = "NONE" | "PSYCHOLOGICAL_99";

/** PSYCHOLOGICAL_99 rounds UP to the next £X.99 -- never down, which would erode the computed margin. */
export function applyRounding(priceMinor: number, rule: RoundingRule): number {
  if (rule === "NONE") return Math.round(priceMinor);
  const pounds = Math.floor(priceMinor / 100);
  const candidate = pounds * 100 + 99;
  return candidate >= priceMinor ? candidate : candidate + 100;
}

export interface PriceRuleInputs {
  costMultiplier: number;
  fixedUpliftMinor: number;
  floorMarginPct: number;
  roundingRule: RoundingRule;
  maxPriceMinor: number | null;
}

export interface RetailPriceResult {
  retailPriceMinor: number;
  marginMinor: number;
  /** Gross margin as a % of the retail (selling) price, not of cost. */
  marginPct: number;
  belowFloorMargin: boolean;
  cappedByMaxPrice: boolean;
}

export function calculateRetailPrice(landedCostMinor: number, rule: PriceRuleInputs): RetailPriceResult {
  const raw = landedCostMinor * rule.costMultiplier + rule.fixedUpliftMinor;
  const rounded = applyRounding(raw, rule.roundingRule);

  let retailPriceMinor = rounded;
  let cappedByMaxPrice = false;
  if (rule.maxPriceMinor !== null && retailPriceMinor > rule.maxPriceMinor) {
    retailPriceMinor = rule.maxPriceMinor;
    cappedByMaxPrice = true;
  }

  const marginMinor = retailPriceMinor - landedCostMinor;
  const marginPct = retailPriceMinor > 0 ? (marginMinor / retailPriceMinor) * 100 : 0;

  return {
    retailPriceMinor,
    marginMinor,
    marginPct,
    belowFloorMargin: marginPct < rule.floorMarginPct,
    cappedByMaxPrice,
  };
}

export interface PricingPreview extends RetailPriceResult {
  landedCostMinor: number;
  supplierPriceMinor: number;
}

export function previewPricing(
  inputs: LandedCostInputs,
  landedCostConfig: LandedCostConfig,
  rule: PriceRuleInputs
): PricingPreview {
  const landedCostMinor = calculateLandedCostMinor(inputs, landedCostConfig);
  const retail = calculateRetailPrice(landedCostMinor, rule);
  return { ...retail, landedCostMinor, supplierPriceMinor: inputs.supplierPriceMinor };
}
