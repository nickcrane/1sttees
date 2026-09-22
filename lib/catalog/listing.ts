import { Prisma } from "@prisma/client";
import type { Product, ProductVariant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { callStructured } from "@/lib/llm/client";
import { listingSchema, type Listing } from "./listing-schema";
import { validateListing } from "./listing-validator";

const SYSTEM_PROMPT = `You write product listings for 1st Tees, a UK e-commerce store selling golf tees.

Voice: quiet confidence. Short declarative sentences. British English. The product is the hero -- say what it is and what it does, then stop.

Do: concrete facts (lengths in mm, pack sizes, materials), "—" where a fact is genuinely unknown, second person sparingly.
Don't: adjectives like premium/high quality/amazing/durable and practical, exclamation marks, emoji, phrases like "for golf lovers", any claim not supported by the data you're given.

You will receive a product's classified material and its variants (each with length in mm, colour, and pack size where known). Write:

- name: exactly "<Material> Tee · <Length>mm" (e.g. "Bamboo Tee · 70mm") using Title Case for material. Use the most common length across the variants you're given if they differ. Colour and pack size never appear here.
- headline: one sentence, under 12 words, the single distinguishing benefit.
- overview: exactly two paragraphs, each 40-70 words. First paragraph: what it is and what it's made of. Second: how it plays -- tee height, driver or iron use, break resistance.
- specification: exactly these nine fields -- material, length, headDiameter, colourOptions, packSizes, finish, biodegradable (must be exactly "Yes", "No", or "—"), weightPerTee, countryOfOrigin. Use "—" for anything not given to you -- never invent a fact.
- inTheBox: one line, e.g. "50 tees, kraft box."
- sustainability: one sentence, only when the material is genuinely bamboo or wood -- otherwise null. Never invented or exaggerated.`;

function buildPrompt(
  title: string,
  material: string | null,
  variants: Array<{ lengthMm: number | null; colour: string | null; packSize: number | null }>
): string {
  const variantLines = variants
    .map((v) => `- length: ${v.lengthMm ?? "unknown"}mm, colour: ${v.colour ?? "unknown"}, pack size: ${v.packSize ?? "unknown"}`)
    .join("\n");
  return `Supplier title: ${title}\nClassified material: ${material ?? "unknown"}\n\nVariants:\n${variantLines}`;
}

async function generateWithClaude(
  title: string,
  material: string | null,
  variants: Array<{ lengthMm: number | null; colour: string | null; packSize: number | null }>
): Promise<Listing> {
  return callStructured({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(title, material, variants),
    schema: listingSchema,
    toolName: "write_listing",
    toolDescription: "Records the generated product listing copy in the required fixed structure.",
    maxTokens: 2048,
  });
}

export interface ListingRunSummary {
  productsConsidered: number;
  generated: number;
  failed: number;
}

/**
 * Stage 4: generates listing copy for every APPROVED/PUBLISHED product
 * that doesn't have one yet, or whose last attempt failed the validator
 * (worth retrying). Deliberately does NOT regenerate an already-valid
 * listing on every run -- docs/product-flow.md's Catalogue view has its
 * own explicit "regenerate listing" admin action for that; this is the
 * generate-once-then-leave-alone nightly pass.
 */
export async function generateListingsForApprovedProducts(): Promise<ListingRunSummary> {
  const products = await prisma.product.findMany({
    where: {
      status: { in: ["APPROVED", "PUBLISHED"] },
      OR: [{ listing: { equals: Prisma.DbNull } }, { validatorErrors: { isEmpty: false } }],
    },
    include: { variants: true },
  });

  let generated = 0;
  let failed = 0;

  for (const product of products) {
    try {
      await generateAndStoreListing(product);
      generated++;
    } catch (error) {
      failed++;
      logger.warn({ productId: product.id, error }, "listing: failed to generate listing, skipping");
    }
  }

  const summary: ListingRunSummary = { productsConsidered: products.length, generated, failed };
  logger.info(summary, "listing: run complete");
  return summary;
}

/** Single-product entry point for the Catalogue view's "Regenerate listing" action. */
export async function regenerateListing(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { variants: true } });
  if (!product) throw new Error("Product not found.");
  await generateAndStoreListing(product);
}

async function generateAndStoreListing(product: Product & { variants: ProductVariant[] }): Promise<void> {
  if (product.variants.length === 0) {
    logger.warn({ productId: product.id }, "listing: product has no variants, skipping");
    return;
  }

  const listing = await generateWithClaude(
    product.title,
    product.material,
    product.variants.map((v) => ({ lengthMm: v.lengthMm, colour: v.colour, packSize: v.packSize }))
  );
  const validatorErrors = validateListing(listing, { material: product.material });

  await prisma.product.update({
    where: { id: product.id },
    data: { listing: listing as unknown as Prisma.InputJsonValue, validatorErrors },
  });
}
