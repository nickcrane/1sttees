import { describe, expect, it } from "vitest";
import { parseAeProductId } from "@/lib/catalog/parse-product-id";

describe("parseAeProductId", () => {
  it("accepts a bare numeric id", () => {
    expect(parseAeProductId("1005006525360508")).toBe("1005006525360508");
  });

  it("accepts a bare numeric id with surrounding whitespace", () => {
    expect(parseAeProductId("  1005006525360508  ")).toBe("1005006525360508");
  });

  it("extracts the id from a full https URL", () => {
    expect(parseAeProductId("https://www.aliexpress.com/item/1005006525360508.html")).toBe("1005006525360508");
  });

  it("extracts the id from a protocol-relative URL with a query string (search result shape)", () => {
    const url = "//www.aliexpress.com/item/1005012377463137.html?skuId=12000058240136449&pdp_ext_f=%7B%7D";
    expect(parseAeProductId(url)).toBe("1005012377463137");
  });

  it("returns null for input with no recognizable product id", () => {
    expect(parseAeProductId("not a product id or url")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseAeProductId("")).toBeNull();
  });
});
