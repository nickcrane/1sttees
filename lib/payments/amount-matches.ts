/**
 * Spec: "Never trust a client-submitted amount... the webhook re-verifies
 * that the amount paid equals the order total before the order moves to
 * PAID." Our own server always creates the PaymentIntent/PayPal order
 * from the order's own totalMinor, so a mismatch here should never
 * happen in the normal flow -- this exists as a defense-in-depth check
 * against a captured amount that's drifted from what we expect (a stale
 * client_secret reused against a different order, a currency mixup),
 * not a routine path.
 */
export function capturedAmountMatchesOrder(
  order: { totalMinor: number; currency: string },
  captured: { amountMinor: number; currency: string }
): boolean {
  return captured.amountMinor === order.totalMinor && captured.currency.toUpperCase() === order.currency.toUpperCase();
}
