import { z } from "zod";

// The nine fixed keys from docs/product-flow.md's Specification table, in
// that order. "—" (an em dash) is the documented sentinel for "fact
// unknown" -- every other value must trace back to real supplier/variant
// data (checked by listing-validator.ts, not by this schema).
export const listingSpecificationSchema = z.object({
  material: z.string(),
  length: z.string(),
  headDiameter: z.string(),
  colourOptions: z.string(),
  packSizes: z.string(),
  finish: z.string(),
  biodegradable: z.enum(["Yes", "No", "—"]),
  weightPerTee: z.string(),
  countryOfOrigin: z.string(),
});
export type ListingSpecification = z.infer<typeof listingSpecificationSchema>;

// Every field always present, in this fixed order -- docs/product-flow.md
// is explicit that the structure never varies, only the content does.
// Selectors (Length/Colour/Pack size) aren't part of this shape: they're
// rendered straight from ProductVariant.lengthMm/colour/packSize, which
// already exist as real, queryable data -- nothing for the model to add.
export const listingSchema = z.object({
  // Pattern: "<Material> Tee · <Length>mm", e.g. "Bamboo Tee · 70mm".
  // Colour and pack size never appear here.
  name: z.string(),
  // One sentence, under 12 words -- the single distinguishing benefit.
  headline: z.string(),
  // Exactly two paragraphs, 40-70 words each: what it is/made of, then
  // how it plays.
  overview: z.tuple([z.string(), z.string()]),
  specification: listingSpecificationSchema,
  // One line, e.g. "50 tees, kraft box."
  inTheBox: z.string(),
  // One sentence, only when the material is genuinely bamboo/wood --
  // null otherwise. Never invented.
  sustainability: z.string().nullable(),
});
export type Listing = z.infer<typeof listingSchema>;
