import type { Listing } from "./listing-schema";

// From docs/product-flow.md's Do/Don't table -- explicitly called-out
// superlatives and supplier-speak the voice guide forbids. Checked as
// whole-word/phrase, case-insensitive.
const BANNED_PHRASES = [
  "premium",
  "high quality",
  "amazing",
  "durable and practical",
  "best",
  "incredible",
  "superior",
  "top quality",
  "wholesale",
  "for golf lovers",
];

// Common emoji ranges -- not exhaustive of every Unicode emoji, but covers
// the pictographs/symbols a model would realistically reach for.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const URL_PATTERN = /https?:\/\/|www\./i;
const NAME_PATTERN = /^[A-Za-z]+ Tee · \d+mm$/;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function checkVoice(label: string, text: string, errors: string[]): void {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) errors.push(`${label} contains a banned word/phrase: "${phrase}"`);
  }
  if (text.includes("!")) errors.push(`${label} contains an exclamation mark`);
  if (EMOJI_PATTERN.test(text)) errors.push(`${label} contains an emoji`);
  if (URL_PATTERN.test(lower)) errors.push(`${label} contains a URL`);
  if (lower.includes("aliexpress")) errors.push(`${label} mentions the supplier by name`);
}

/**
 * The validator from docs/product-flow.md Stage 4: a hard fail here is
 * what puts a listing in "needs review" in the Catalogue view rather than
 * publishing it as-is. Deliberately covers only what's mechanically
 * checkable from the text itself (word counts, the Name pattern, banned
 * words, structure) -- verifying every specification value genuinely
 * traces back to supplier data would need another model call to judge,
 * which is a validator problem of its own the doc doesn't ask this
 * function to solve.
 */
export function validateListing(listing: Listing, product: { material: string | null }): string[] {
  const errors: string[] = [];

  if (!NAME_PATTERN.test(listing.name)) {
    errors.push(`Name "${listing.name}" doesn't match the required "<Material> Tee · <Length>mm" pattern`);
  }

  const headlineWords = countWords(listing.headline);
  if (headlineWords === 0 || headlineWords >= 12) {
    errors.push(`Headline is ${headlineWords} words, must be under 12`);
  }

  if (listing.overview.length !== 2) {
    errors.push(`Overview has ${listing.overview.length} paragraphs, must be exactly 2`);
  } else {
    listing.overview.forEach((paragraph, i) => {
      const words = countWords(paragraph);
      if (words < 40 || words > 70) {
        errors.push(`Overview paragraph ${i + 1} is ${words} words, must be 40-70`);
      }
    });
  }

  const inTheBoxWords = countWords(listing.inTheBox);
  if (inTheBoxWords === 0) {
    errors.push("In the box is empty");
  } else if (listing.inTheBox.includes("\n")) {
    errors.push("In the box must be a single line");
  }

  if (listing.sustainability !== null) {
    const materialSupportsSustainability = product.material === "bamboo" || product.material === "wood" || product.material === "mixed";
    if (!materialSupportsSustainability) {
      errors.push(`Sustainability line present but product material is "${product.material}", not bamboo/wood/mixed`);
    }
    if (countWords(listing.sustainability) > 40) {
      errors.push("Sustainability line is too long to be one sentence");
    }
  }

  checkVoice("Headline", listing.headline, errors);
  checkVoice("Overview paragraph 1", listing.overview[0] ?? "", errors);
  checkVoice("Overview paragraph 2", listing.overview[1] ?? "", errors);
  checkVoice("In the box", listing.inTheBox, errors);
  if (listing.sustainability) checkVoice("Sustainability", listing.sustainability, errors);

  return errors;
}
