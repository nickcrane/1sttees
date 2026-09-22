import type { OrderStatus } from "@prisma/client";

/** Customer-facing order status labels -- the raw enum names are fine for
 * admin (internal tooling), but "HOLD"/"SUPPLIER_ORDER_QUEUED" read as
 * something being wrong rather than the normal, brief steps they are. */
const CUSTOMER_STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Awaiting payment",
  HOLD: "Order received",
  SUPPLIER_ORDER_QUEUED: "Preparing your order",
  SUPPLIER_ORDER_PLACED: "Preparing your order",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  SUPPLIER_ORDER_FAILED: "Delayed -- we're on it",
  NEEDS_MANUAL_REVIEW: "Delayed -- we're on it",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export function customerOrderStatusLabel(status: OrderStatus): string {
  return CUSTOMER_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}
