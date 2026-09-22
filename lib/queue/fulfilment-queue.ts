import { Queue } from "bullmq";
import { queueConnection } from "@/lib/queue/connection";

export const FULFILMENT_QUEUE_NAME = "fulfilment";
export const PLACE_SUPPLIER_ORDER_JOB = "place-supplier-order";
export const SYNC_TRACKING_JOB = "sync-tracking";

export interface PlaceSupplierOrderJobData {
  orderId: string;
}

export const fulfilmentQueue = new Queue(FULFILMENT_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    // Keep completed jobs a week for the audit trail; keep every failed
    // job (no age/count cap) so a permanently-failed placement stays
    // visible for manual triage rather than aging out silently.
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: false,
  },
});

/**
 * Enqueues placing the AliExpress order(s) for a just-paid Order, delayed
 * by `delayMs` (the cancellation-hold window -- see
 * lib/orders/confirm-payment.ts's markOrderPaid). jobId is the order id,
 * not a random id -- a second enqueue for the same order (a retried
 * webhook, a re-run job) is a no-op at the queue level rather than a
 * duplicate job, on top of place-supplier-order.ts's own status guard.
 */
export async function enqueuePlaceSupplierOrder(orderId: string, delayMs = 0): Promise<void> {
  // BullMQ v6 rejects a custom Job Id containing ":" -- confirmed live
  // (Error: Custom Id cannot contain :) -- so this uses "-" rather than
  // the more common ":"-namespaced convention seen in older BullMQ docs.
  await fulfilmentQueue.add(PLACE_SUPPLIER_ORDER_JOB, { orderId } satisfies PlaceSupplierOrderJobData, {
    jobId: `${PLACE_SUPPLIER_ORDER_JOB}-${orderId}`,
    delay: delayMs,
  });
}
