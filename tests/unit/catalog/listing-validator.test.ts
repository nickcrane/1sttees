import { describe, expect, it } from "vitest";
import { validateListing } from "@/lib/catalog/listing-validator";
import type { Listing } from "@/lib/catalog/listing-schema";

const PARAGRAPH_50_WORDS = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");

function validListing(overrides: Partial<Listing> = {}): Listing {
  return {
    name: "Bamboo Tee · 70mm",
    headline: "Cut from a single piece of bamboo.",
    overview: [PARAGRAPH_50_WORDS, PARAGRAPH_50_WORDS],
    specification: {
      material: "Bamboo",
      length: "70mm",
      headDiameter: "—",
      colourOptions: "Natural",
      packSizes: "50",
      finish: "Sanded",
      biodegradable: "Yes",
      weightPerTee: "—",
      countryOfOrigin: "—",
    },
    inTheBox: "50 tees, kraft box.",
    sustainability: "Grown and harvested from a renewable bamboo source.",
    ...overrides,
  };
}

const BAMBOO_PRODUCT = { material: "bamboo" };

describe("validateListing", () => {
  it("returns no errors for a listing that follows every rule", () => {
    expect(validateListing(validListing(), BAMBOO_PRODUCT)).toEqual([]);
  });

  it("flags a Name that doesn't match the pattern", () => {
    const errors = validateListing(validListing({ name: "Bamboo Golf Tee 70mm" }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("doesn't match the required"))).toBe(true);
  });

  it("flags a Headline of 12 or more words", () => {
    const headline = Array.from({ length: 12 }, (_, i) => `w${i}`).join(" ");
    const errors = validateListing(validListing({ headline }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("Headline is 12 words"))).toBe(true);
  });

  it("flags an Overview paragraph outside 40-70 words", () => {
    const short = Array.from({ length: 10 }, (_, i) => `w${i}`).join(" ");
    const errors = validateListing(validListing({ overview: [short, PARAGRAPH_50_WORDS] }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("paragraph 1 is 10 words"))).toBe(true);
  });

  it("flags a sustainability line when the product material isn't bamboo/wood/mixed", () => {
    const errors = validateListing(validListing({ sustainability: "Renewable and biodegradable." }), { material: "plastic" });
    expect(errors.some((e) => e.includes("not bamboo/wood/mixed"))).toBe(true);
  });

  it("allows a null sustainability line regardless of material", () => {
    const errors = validateListing(validListing({ sustainability: null }), { material: "plastic" });
    expect(errors.some((e) => e.toLowerCase().includes("sustainability"))).toBe(false);
  });

  it("flags a banned word in the headline", () => {
    const errors = validateListing(validListing({ headline: "Premium bamboo tees." }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes('banned word/phrase: "premium"'))).toBe(true);
  });

  it("flags an exclamation mark", () => {
    const errors = validateListing(validListing({ headline: "Splits less!" }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("exclamation mark"))).toBe(true);
  });

  it("flags an emoji", () => {
    const errors = validateListing(validListing({ headline: "Splits less \u{1F3CC}\u{FE0F}" }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("emoji"))).toBe(true);
  });

  it("flags a URL", () => {
    const errors = validateListing(validListing({ inTheBox: "See www.example.com for details." }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("URL"))).toBe(true);
  });

  it("flags a mention of the supplier by name", () => {
    const errors = validateListing(validListing({ inTheBox: "As sold on AliExpress." }), BAMBOO_PRODUCT);
    expect(errors.some((e) => e.includes("mentions the supplier"))).toBe(true);
  });
});
