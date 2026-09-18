import { randomBytes } from "node:crypto";

/**
 * e.g. "1ST-20260918-9F3C2A" -- human-readable (customers read these back
 * over email/support), roughly sortable by date, and the 6-char random
 * suffix is more than enough entropy for a single small store's order
 * volume (createPendingOrder relies on Order.orderNumber's unique
 * constraint to catch the astronomically unlikely collision, not this
 * function being collision-proof on its own).
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `1ST-${datePart}-${randomPart}`;
}
