import { describe, expect, it } from "vitest";
import { signCartId, verifyCartId } from "@/lib/cart/signed-cart-id";

describe("signCartId / verifyCartId", () => {
  it("round-trips a signed id", () => {
    const signed = signCartId("clx1234567890");
    expect(verifyCartId(signed)).toBe("clx1234567890");
  });

  it("rejects a tampered id with the original signature", () => {
    const signed = signCartId("clx1234567890");
    const [, signature] = signed.split(".");
    const tampered = `clx0000000000.${signature}`;
    expect(verifyCartId(tampered)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const signed = signCartId("clx1234567890");
    const tampered = `${signed}corrupted`;
    expect(verifyCartId(tampered)).toBeNull();
  });

  it("rejects a value with no separator", () => {
    expect(verifyCartId("not-a-signed-value")).toBeNull();
  });

  it("rejects an empty or missing value", () => {
    expect(verifyCartId("")).toBeNull();
    expect(verifyCartId(undefined)).toBeNull();
    expect(verifyCartId(null)).toBeNull();
  });

  it("rejects a signature of the wrong length rather than throwing", () => {
    expect(verifyCartId("clx1234567890.short")).toBeNull();
  });
});
