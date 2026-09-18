import { prisma } from "@/lib/prisma";
import type { PriceRuleInputs } from "@/lib/pricing/calculate";

const FALLBACK_RULE: PriceRuleInputs = {
  costMultiplier: 2.5,
  fixedUpliftMinor: 0,
  floorMarginPct: 20,
  roundingRule: "PSYCHOLOGICAL_99",
  maxPriceMinor: null,
};

/** A PRODUCT-scoped rule (if one exists for `productId`) overrides the GLOBAL rule; falls back to a hardcoded default if neither exists yet (e.g. before the seed script has run). */
export async function getApplicablePriceRule(productId?: string): Promise<PriceRuleInputs> {
  if (productId) {
    const productRule = await prisma.priceRule.findFirst({ where: { scope: "PRODUCT", productId } });
    if (productRule) return toPriceRuleInputs(productRule);
  }
  const globalRule = await prisma.priceRule.findFirst({ where: { scope: "GLOBAL" }, orderBy: { createdAt: "desc" } });
  return globalRule ? toPriceRuleInputs(globalRule) : FALLBACK_RULE;
}

function toPriceRuleInputs(rule: {
  costMultiplier: number;
  fixedUpliftMinor: number;
  floorMarginPct: number;
  roundingRule: string;
  maxPriceMinor: number | null;
}): PriceRuleInputs {
  return {
    costMultiplier: rule.costMultiplier,
    fixedUpliftMinor: rule.fixedUpliftMinor,
    floorMarginPct: rule.floorMarginPct,
    roundingRule: rule.roundingRule as PriceRuleInputs["roundingRule"],
    maxPriceMinor: rule.maxPriceMinor,
  };
}
