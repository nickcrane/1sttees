import { describe, expect, it } from "vitest";
import { variantTitle } from "@/lib/catalog/import";

describe("variantTitle", () => {
  it("takes the human-readable label after # for a single-group sku_attr (confirmed live shape for golf tees)", () => {
    expect(variantTitle("14:200000led#83mm")).toBe("83mm");
  });

  it("joins labels from multiple ;-separated groups, skipping groups with no # label (confirmed live shape for the test-account T-shirt)", () => {
    // group 1 "5:4182" has no label, group 2 "14:1254#tianlan" has "tianlan",
    // group 3 "200007763:201441035" has no label -- only "tianlan" survives.
    expect(variantTitle("5:4182;14:1254#tianlan;200007763:201441035")).toBe("tianlan");
  });

  it("joins multiple labelled groups with a separator", () => {
    expect(variantTitle("5:1#Red;14:2#Large")).toBe("Red / Large");
  });

  it("falls back to the raw string when no group has a label", () => {
    expect(variantTitle("14:200000led")).toBe("14:200000led");
  });

  it("falls back to 'Default' for an empty sku_attr (single-SKU products confirmed to have this live)", () => {
    expect(variantTitle("")).toBe("Default");
  });
});
