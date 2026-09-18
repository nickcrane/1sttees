import { NextResponse } from "next/server";
import { z } from "zod";
import { importAliExpressProduct, ProductImportError } from "@/lib/catalog/import";
import { logger } from "@/lib/logger";
import { AliExpressApiError } from "@/lib/aliexpress/errors";

const bodySchema = z.object({
  productIdOrUrl: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const result = await importAliExpressProduct(parsed.data.productIdOrUrl);
    return NextResponse.json({
      product: result.product,
      variantCount: result.variants.length,
      anyBelowFloorMargin: result.variants.some((v) => v.belowFloorMargin),
    });
  } catch (error) {
    if (error instanceof ProductImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AliExpressApiError) {
      logger.warn({ error: error.detail }, "AliExpress error during product import");
      return NextResponse.json({ error: `AliExpress: ${error.message}` }, { status: 502 });
    }
    throw error;
  }
}
