import { describe, expect, it } from "vitest";
import { slugify, toMinorUnits } from "@/lib/catalog/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Natural Bamboo Golf Tees 83mm")).toBe("natural-bamboo-golf-tees-83mm");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Golf Tees, Bamboo (Pack of 100)!")).toBe("golf-tees-bamboo-pack-of-100");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Bamboo Tees--  ")).toBe("bamboo-tees");
  });

  it("caps length at 80 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});

describe("toMinorUnits", () => {
  it("converts a major-unit price to pence", () => {
    expect(toMinorUnits(6.99)).toBe(699);
  });

  it("rounds away floating point error", () => {
    // 6.99 * 100 in raw JS floating point is 698.9999999999999
    expect(toMinorUnits(6.99)).toBe(699);
    expect(toMinorUnits(0.1)).toBe(10);
  });

  it("handles zero", () => {
    expect(toMinorUnits(0)).toBe(0);
  });
});
