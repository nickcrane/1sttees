import type { ProductStatus } from "@prisma/client";

export interface Transition {
  from: readonly ProductStatus[];
  to: ProductStatus;
  auditAction: string;
}

// The only transitions an admin curation action (lib/catalog/
// curation-actions.ts) is allowed to make, per docs/product-flow.md's
// Stage 3 state diagram. A generic "set any status from anywhere" update
// would let a UI bug silently skip a step (e.g. REJECTED straight to
// PUBLISHED) -- keeping this as an explicit table turns an illegal
// transition into a thrown error instead.
export const PRODUCT_TRANSITIONS = {
  approve: { from: ["CANDIDATE"], to: "APPROVED", auditAction: "PRODUCT_APPROVED" },
  reject: { from: ["CANDIDATE", "REVIEW"], to: "REJECTED", auditAction: "PRODUCT_REJECTED" },
  park: { from: ["CANDIDATE"], to: "PARKED", auditAction: "PRODUCT_PARKED" },
  // The Review queue's one listed action (docs/product-flow.md): an
  // admin override sends a low-confidence/rejected-by-classifier product
  // back to Candidates rather than approving it directly, so it still
  // goes through the normal Approve/Reject/Park decision.
  sendToCandidates: { from: ["REVIEW"], to: "CANDIDATE", auditAction: "PRODUCT_SENT_TO_CANDIDATES" },
  publish: { from: ["APPROVED"], to: "PUBLISHED", auditAction: "PRODUCT_PUBLISHED" },
  unpublish: { from: ["PUBLISHED"], to: "APPROVED", auditAction: "PRODUCT_UNPUBLISHED" },
  retire: { from: ["APPROVED", "PUBLISHED", "PARKED", "REJECTED"], to: "RETIRED", auditAction: "PRODUCT_RETIRED" },
} as const satisfies Record<string, Transition>;

export type CurationAction = keyof typeof PRODUCT_TRANSITIONS;

export function isValidTransition(action: CurationAction, fromStatus: ProductStatus): boolean {
  // Widened to a plain readonly array before `.includes` -- indexing
  // PRODUCT_TRANSITIONS by the CurationAction union otherwise leaves
  // `.from` typed as a union of several distinct literal-tuple types,
  // and TS resolves `.includes`'s parameter type across that union to
  // `never` rather than `ProductStatus`.
  const from: readonly ProductStatus[] = PRODUCT_TRANSITIONS[action].from;
  return from.includes(fromStatus);
}
