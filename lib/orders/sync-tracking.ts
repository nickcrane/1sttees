import { AliExpressClient } from "@/lib/aliexpress/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const aliExpressClient = new AliExpressClient();

const DELIVERED_PATTERN = /delivered/i;

/**
 * Polls tracking (one aliexpress.ds.order.tracking.get call per supplier
 * order id) for every order that's been placed but isn't delivered yet,
 * and updates trackingNumber/trackingCarrier/shippedAt/status/deliveredAt
 * as they appear. "Delivered" is a best-effort heuristic -- a tracking
 * event whose name/description matches /delivered/i -- since AliExpress's
 * tracking API returns a free-text event list, not a dedicated delivered
 * boolean/enum (order_status on aliexpress.ds.order.get is a candidate
 * for a more reliable signal, but wasn't confirmed live against a real
 * shipped order as of Phase 4; see docs/decisions.md).
 */
export async function syncTracking(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { status: { in: ["SUPPLIER_ORDER_PLACED", "SHIPPED"] }, supplierOrderIds: { isEmpty: false } },
  });

  for (const order of orders) {
    for (const supplierOrderId of order.supplierOrderIds) {
      try {
        const [line] = await aliExpressClient.getOrderTracking(supplierOrderId);
        if (!line) continue;

        const delivered = line.events.some(
          (event) => DELIVERED_PATTERN.test(event.name ?? "") || DELIVERED_PATTERN.test(event.description ?? "")
        );

        await prisma.order.update({
          where: { id: order.id },
          data: {
            trackingNumber: line.mailNo ?? order.trackingNumber,
            trackingCarrier: line.carrierName ?? order.trackingCarrier,
            shippedAt: order.shippedAt ?? (line.mailNo ? new Date() : null),
            deliveredAt: delivered ? (order.deliveredAt ?? new Date()) : order.deliveredAt,
            status: delivered ? "DELIVERED" : line.mailNo ? "SHIPPED" : order.status,
          },
        });
      } catch (error) {
        logger.warn({ orderId: order.id, supplierOrderId, error }, "syncTracking: failed to sync one order");
      }
    }
  }
}
