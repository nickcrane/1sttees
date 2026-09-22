export interface FulfilmentItemCheck {
  titleSnapshot: string;
  productStatus: string;
  currentSupplierPriceMinor: number;
  supplierCostMinorSnapshot: number;
}

/**
 * Spec: "Before placing, re-validate: variant still available, supplier
 * price hasn't moved more than X% (configurable, default 10%)... On
 * violation -> NEEDS_MANUAL_REVIEW + admin alert, never auto-place." The
 * cancellation-hold window this runs after is exactly the gap where a
 * supplier price or availability change could go unnoticed without this
 * check -- an order can sit for up to ORDER_HOLD_MINUTES before
 * place-supplier-order.ts ever calls this.
 *
 * Returns a human-readable reason for the first failing item, or null if
 * every item is still valid to place.
 */
export function findValidationFailure(items: FulfilmentItemCheck[], driftTolerancePct: number): string | null {
  for (const item of items) {
    if (item.productStatus !== "PUBLISHED") {
      return `"${item.titleSnapshot}" is no longer available`;
    }

    if (item.supplierCostMinorSnapshot > 0) {
      const driftPct =
        (Math.abs(item.currentSupplierPriceMinor - item.supplierCostMinorSnapshot) / item.supplierCostMinorSnapshot) * 100;
      if (driftPct > driftTolerancePct) {
        return `Supplier price for "${item.titleSnapshot}" moved ${driftPct.toFixed(1)}% since purchase (tolerance ${driftTolerancePct}%)`;
      }
    }
  }
  return null;
}
