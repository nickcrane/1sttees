import { describe, expect, it } from "vitest";
import { mineRejectFeedback, tokenizeTitle, titleMatchesFlaggedTerm } from "@/lib/catalog/reject-feedback";

describe("tokenizeTitle", () => {
  it("lowercases, splits on non-alphanumerics, and drops stopwords/numbers/short tokens", () => {
    expect(tokenizeTitle("50pcs Premium Wooden Golf Tees with Height Markers")).toEqual(["height", "markers"]);
  });
});

describe("mineRejectFeedback", () => {
  it("returns the most recent rejections' metadata, verbatim, as examples", () => {
    const feedback = mineRejectFeedback(
      [
        { title: "Golf Glove Set", material: "plastic", skuAttrs: ["Color: Black"] },
        { title: "Plastic Golf Tees", material: "plastic", skuAttrs: ["14:200000led#70mm"] },
      ],
      []
    );
    expect(feedback.examples).toEqual([
      { title: "Golf Glove Set", material: "plastic", skuAttrs: ["Color: Black"] },
      { title: "Plastic Golf Tees", material: "plastic", skuAttrs: ["14:200000led#70mm"] },
    ]);
  });

  it("includes a rejection with no classifier material guess and no sku_attrs (an admin rejecting a CANDIDATE with none recorded)", () => {
    const feedback = mineRejectFeedback([{ title: "Unexplained Reject", material: null, skuAttrs: [] }], []);
    expect(feedback.examples).toEqual([{ title: "Unexplained Reject", material: null, skuAttrs: [] }]);
  });

  it("caps examples at 8, keeping the input order (most-recent-first is the caller's job)", () => {
    const rejected = Array.from({ length: 12 }, (_, i) => ({ title: `Product ${i}`, material: null, skuAttrs: [] }));
    const feedback = mineRejectFeedback(rejected, []);
    expect(feedback.examples).toHaveLength(8);
    expect(feedback.examples[0]).toEqual({ title: "Product 0", material: null, skuAttrs: [] });
  });

  it("flags a term repeated across >=2 rejected titles and absent from every accepted title", () => {
    const feedback = mineRejectFeedback(
      [
        { title: "Golf Glove and Tee Combo", material: null, skuAttrs: [] },
        { title: "Tee and Glove Value Pack", material: null, skuAttrs: [] },
      ],
      [{ title: "Bamboo Golf Tees 70mm" }, { title: "Wooden Golf Tees 83mm" }]
    );
    expect(feedback.flaggedTerms).toContain("glove");
  });

  it("does not flag a term that also appears in an accepted title", () => {
    const feedback = mineRejectFeedback(
      [
        { title: "Bulk Golf Tees Bag", material: null, skuAttrs: [] },
        { title: "Golf Tees Storage Bag", material: null, skuAttrs: [] },
      ],
      [{ title: "Bamboo Golf Tees Gift Bag" }]
    );
    expect(feedback.flaggedTerms).not.toContain("bag");
  });

  it("does not flag a term that only appears once across rejected titles", () => {
    const feedback = mineRejectFeedback([{ title: "Golf Ball Marker Set", material: null, skuAttrs: [] }], []);
    expect(feedback.flaggedTerms).not.toContain("marker");
  });
});

describe("titleMatchesFlaggedTerm", () => {
  it("returns the matching term when the title contains one", () => {
    expect(titleMatchesFlaggedTerm("Golf Glove and Tee Combo", ["glove"])).toBe("glove");
  });

  it("returns null when no flagged term is present", () => {
    expect(titleMatchesFlaggedTerm("Bamboo Golf Tees 70mm", ["glove"])).toBeNull();
  });

  it("returns null when there are no flagged terms at all", () => {
    expect(titleMatchesFlaggedTerm("Bamboo Golf Tees 70mm", [])).toBeNull();
  });
});
