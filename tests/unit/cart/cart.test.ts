import { describe, expect, it } from "vitest";
import { calculateCartTotals, type CartWithItems } from "@/lib/cart/cart";

// calculateCartTotals only reads item.quantity and item.productVariant.{priceMinor,currency}
// -- the fixture below fills in just those, cast past the rest of Prisma's generated shape.
function fixtureCart(items: Array<{ priceMinor: number; quantity: number; currency?: string }>): CartWithItems {
  return {
    id: "cart_1",
    items: items.map((item, index) => ({
      id: `item_${index}`,
      quantity: item.quantity,
      productVariant: {
        priceMinor: item.priceMinor,
        currency: item.currency ?? "GBP",
      },
    })),
  } as unknown as CartWithItems;
}

describe("calculateCartTotals", () => {
  it("sums quantities and price*quantity across items", () => {
    const cart = fixtureCart([
      { priceMinor: 599, quantity: 2 },
      { priceMinor: 1299, quantity: 1 },
    ]);

    expect(calculateCartTotals(cart)).toEqual({
      itemCount: 3,
      subtotalMinor: 599 * 2 + 1299,
      currency: "GBP",
    });
  });

  it("returns zeroed totals for an empty cart, defaulting currency to GBP", () => {
    const cart = fixtureCart([]);
    expect(calculateCartTotals(cart)).toEqual({
      itemCount: 0,
      subtotalMinor: 0,
      currency: "GBP",
    });
  });
});
