import { prisma } from "@/lib/prisma";
import type { Product, ProductVariant } from "@prisma/client";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

const variantOrder = { orderBy: { position: "asc" as const } };

export async function listPublishedProducts(): Promise<ProductWithVariants[]> {
  return prisma.product.findMany({
    where: { status: "PUBLISHED" },
    include: { variants: variantOrder },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPublishedProductBySlug(slug: string): Promise<ProductWithVariants | null> {
  return prisma.product.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: { variants: variantOrder },
  });
}

/** Lowest-priced variant, used for a product's "from £X" card price. */
export function leadPriceMinor(product: ProductWithVariants): number | null {
  if (product.variants.length === 0) return null;
  return Math.min(...product.variants.map((variant) => variant.priceMinor));
}
