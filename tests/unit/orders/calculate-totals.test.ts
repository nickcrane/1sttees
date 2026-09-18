import { describe, expect, it } from "vitest";
import { calculateOrderTotals, type OrderLineInput } from "@/lib/orders/calculate-totals";

const LINES: OrderLineInput[] = [
  { priceMinor: 999, quantity: 2, currency: "GBP" },
  { priceMinor: 1099, quantity: 1, currency: "GBP" },
];

describe("calculateOrderTotals", () => {
  it("sums line items and charges no VAT or shipping when NOT_REGISTERED", () => {
    expect(calculateOrderTotals(LINES, "NOT_REGISTERED")).toEqual({
      subtotalMinor: 999 * 2 + 1099,
      shippingMinor: 0,
      vatMinor: 0,
      vatRateBps: 0,
      totalMinor: 999 * 2 + 1099,
      currency: "GBP",
    });
  });

  it("extracts VAT-inclusive VAT at 20% when REGISTERED, without changing the total", () => {
    const notRegistered = calculateOrderTotals(LINES, "NOT_REGISTERED");
    const registered = calculateOrderTotals(LINES, "REGISTERED");

    expect(registered.totalMinor).toBe(notRegistered.totalMinor);
    expect(registered.vatRateBps).toBe(2000);
    // total / 1.2 * 0.2, rounded
    expect(registered.vatMinor).toBe(Math.round((registered.totalMinor * 2000) / 12000));
  });

  it("returns zeroed totals and defaults currency to GBP for an empty line list", () => {
    expect(calculateOrderTotals([], "NOT_REGISTERED")).toEqual({
      subtotalMinor: 0,
      shippingMinor: 0,
      vatMinor: 0,
      vatRateBps: 0,
      totalMinor: 0,
      currency: "GBP",
    });
  });
});
