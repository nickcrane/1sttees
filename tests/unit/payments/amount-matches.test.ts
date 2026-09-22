import { describe, expect, it } from "vitest";
import { capturedAmountMatchesOrder } from "@/lib/payments/amount-matches";

describe("capturedAmountMatchesOrder", () => {
  it("matches when amount and currency are identical", () => {
    expect(
      capturedAmountMatchesOrder({ totalMinor: 1999, currency: "GBP" }, { amountMinor: 1999, currency: "GBP" })
    ).toBe(true);
  });

  it("is case-insensitive on currency", () => {
    expect(
      capturedAmountMatchesOrder({ totalMinor: 1999, currency: "GBP" }, { amountMinor: 1999, currency: "gbp" })
    ).toBe(true);
  });

  it("rejects a mismatched amount", () => {
    expect(
      capturedAmountMatchesOrder({ totalMinor: 1999, currency: "GBP" }, { amountMinor: 999, currency: "GBP" })
    ).toBe(false);
  });

  it("rejects a mismatched currency", () => {
    expect(
      capturedAmountMatchesOrder({ totalMinor: 1999, currency: "GBP" }, { amountMinor: 1999, currency: "EUR" })
    ).toBe(false);
  });
});
