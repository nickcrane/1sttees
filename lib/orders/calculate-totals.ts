export interface OrderLineInput {
  priceMinor: number;
  quantity: number;
  currency: string;
}

export interface OrderTotals {
  subtotalMinor: number;
  shippingMinor: number;
  vatMinor: number;
  vatRateBps: number;
  totalMinor: number;
  currency: string;
}

const VAT_STANDARD_RATE_BPS = 2000; // 20% UK standard rate

// No shipping-rate engine yet (the AliExpress freight-quote API from Phase 1
// informs fulfilment cost/pricing, not a customer-facing checkout rate) --
// free shipping is an intentional Phase 3 simplification, see docs/decisions.md.
const FREE_SHIPPING_MINOR = 0;

/**
 * Recomputes an order's amounts server-side from the cart's live line
 * items -- the checkout flow must never trust a client-submitted total.
 * Under VAT_MODE=REGISTERED, prices are treated as VAT-inclusive (standard
 * UK consumer pricing): vatMinor is the VAT portion already embedded in
 * totalMinor, not an amount added on top.
 */
export function calculateOrderTotals(
  lines: OrderLineInput[],
  vatMode: "NOT_REGISTERED" | "REGISTERED"
): OrderTotals {
  const subtotalMinor = lines.reduce((sum, line) => sum + line.priceMinor * line.quantity, 0);
  const currency = lines[0]?.currency ?? "GBP";
  const shippingMinor = FREE_SHIPPING_MINOR;
  const totalMinor = subtotalMinor + shippingMinor;

  if (vatMode === "NOT_REGISTERED") {
    return { subtotalMinor, shippingMinor, vatMinor: 0, vatRateBps: 0, totalMinor, currency };
  }

  const vatMinor = Math.round((totalMinor * VAT_STANDARD_RATE_BPS) / (10000 + VAT_STANDARD_RATE_BPS));
  return { subtotalMinor, shippingMinor, vatMinor, vatRateBps: VAT_STANDARD_RATE_BPS, totalMinor, currency };
}
