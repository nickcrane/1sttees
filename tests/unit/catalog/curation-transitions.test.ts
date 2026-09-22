import { describe, expect, it } from "vitest";
import type { ProductStatus } from "@prisma/client";
import { PRODUCT_TRANSITIONS, isValidTransition, type CurationAction } from "@/lib/catalog/curation-transitions";

const ALL_STATUSES: ProductStatus[] = ["CANDIDATE", "REVIEW", "APPROVED", "REJECTED", "PARKED", "PUBLISHED", "RETIRED"];

describe("isValidTransition", () => {
  for (const action of Object.keys(PRODUCT_TRANSITIONS) as CurationAction[]) {
    const { from } = PRODUCT_TRANSITIONS[action];

    it(`"${action}" allows exactly {${from.join(", ")}}, nothing else`, () => {
      for (const status of ALL_STATUSES) {
        expect(isValidTransition(action, status)).toBe((from as readonly ProductStatus[]).includes(status));
      }
    });
  }

  it("never allows any action from RETIRED -- a terminal state", () => {
    for (const action of Object.keys(PRODUCT_TRANSITIONS) as CurationAction[]) {
      expect(isValidTransition(action, "RETIRED")).toBe(false);
    }
  });
});
