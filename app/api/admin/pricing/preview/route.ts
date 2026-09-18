import { NextResponse } from "next/server";
import { z } from "zod";
import { previewPricing, type RoundingRule } from "@/lib/pricing/calculate";
import { landedCostConfigFromEnv } from "@/lib/pricing/config";
import { getApplicablePriceRule } from "@/lib/catalog/pricing-rules";

const bodySchema = z.object({
  supplierPriceMinor: z.number().nonnegative(),
  supplierShippingMinor: z.number().nonnegative().default(0),
  productId: z.string().optional(),
  ruleOverride: z
    .object({
      costMultiplier: z.number().positive().optional(),
      fixedUpliftMinor: z.number().optional(),
      floorMarginPct: z.number().optional(),
      roundingRule: z.enum(["NONE", "PSYCHOLOGICAL_99"]).optional(),
      maxPriceMinor: z.number().nullable().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { supplierPriceMinor, supplierShippingMinor, productId, ruleOverride } = parsed.data;

  const baseRule = await getApplicablePriceRule(productId);
  const rule = {
    ...baseRule,
    ...ruleOverride,
    roundingRule: (ruleOverride?.roundingRule ?? baseRule.roundingRule) as RoundingRule,
  };

  const preview = previewPricing({ supplierPriceMinor, supplierShippingMinor }, landedCostConfigFromEnv(), rule);
  return NextResponse.json(preview);
}
