// Turns admin reject decisions (a Product an admin explicitly moved to
// REJECTED via curation-actions.ts's rejectProductAction -- no reason
// typed in, by design) into signal the Stage 2 classifier can use: a
// handful of real examples fed to its prompt as-is (title, the
// classifier's own material guess, and the supplier's raw sku_attrs --
// exactly the metadata the classifier already reasons over for every
// other product, tagged as "an admin rejected this one"), and a small
// set of title terms that show up repeatedly in rejects but never in
// anything that's been accepted. Pure/data-in-data-out so it's unit
// tested directly -- classify.ts owns fetching the Product rows (via
// Prisma) and calling in here, same split as classify-decision.ts.

export interface RejectedProductRecord {
  title: string;
  material: string | null;
  skuAttrs: string[];
}

export interface AcceptedProductRecord {
  title: string;
}

export type RejectExample = RejectedProductRecord;

export interface RejectFeedback {
  examples: RejectExample[];
  flaggedTerms: string[];
}

const MAX_EXAMPLES = 8;
const MIN_REJECT_OCCURRENCES = 2;

// Generic tee/golf vocabulary that would otherwise dominate both rejected
// and accepted titles alike -- excluding it is what keeps flaggedTerms
// specific ("glove", "bag") instead of useless ("golf", "tee").
const STOPWORDS = new Set([
  "golf",
  "tee",
  "tees",
  "wood",
  "wooden",
  "bamboo",
  "pcs",
  "pack",
  "packs",
  "set",
  "sets",
  "natural",
  "new",
  "premium",
  "the",
  "and",
  "for",
  "with",
  "of",
  "in",
  "to",
  "a",
  "an",
]);

export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    // Drops both plain numbers and quantity/size tokens glued to one
    // ("50pcs", "83mm") -- common in these titles, but a measurement, not
    // a category word, so treating it as reject signal would be noise.
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d/.test(word));
}

/**
 * examples: the most recent rejections, metadata verbatim -- no written
 * reason to draw on, so this hands the classifier the same kind of raw
 * material/sku_attrs data it already reasons over for every product, and
 * lets it infer for itself what these had in common.
 *
 * flaggedTerms: title words that appear in >= MIN_REJECT_OCCURRENCES
 * distinct rejected titles and in zero accepted ones. A term any accepted
 * product also uses can't be a reliable reject signal, so it's dropped
 * rather than risk flagging a genuine candidate.
 */
export function mineRejectFeedback(rejected: RejectedProductRecord[], accepted: AcceptedProductRecord[]): RejectFeedback {
  const examples = rejected.slice(0, MAX_EXAMPLES);

  const rejectTermCounts = new Map<string, number>();
  for (const p of rejected) {
    for (const term of new Set(tokenizeTitle(p.title))) {
      rejectTermCounts.set(term, (rejectTermCounts.get(term) ?? 0) + 1);
    }
  }

  const acceptedTerms = new Set<string>();
  for (const p of accepted) {
    for (const term of tokenizeTitle(p.title)) acceptedTerms.add(term);
  }

  const flaggedTerms = [...rejectTermCounts.entries()]
    .filter(([term, count]) => count >= MIN_REJECT_OCCURRENCES && !acceptedTerms.has(term))
    .map(([term]) => term)
    .sort();

  return { examples, flaggedTerms };
}

/** First flagged term found in the title, or null. Used to downgrade an otherwise-CANDIDATE decision to REVIEW -- never straight to REJECTED, matching docs/product-flow.md's "never silently dropped" rule. */
export function titleMatchesFlaggedTerm(title: string, flaggedTerms: string[]): string | null {
  if (flaggedTerms.length === 0) return null;
  const titleTerms = new Set(tokenizeTitle(title));
  return flaggedTerms.find((term) => titleTerms.has(term)) ?? null;
}
