import { Queue } from "bullmq";
import { queueConnection } from "@/lib/queue/connection";

export const CATALOG_QUEUE_NAME = "catalog";
export const DISCOVER_PRODUCTS_JOB = "discover-products";

export const catalogQueue = new Queue(CATALOG_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    // A run's own findings (which products it saw, what it stored) live in
    // SupplierProduct itself -- the job record only needs to stick around
    // long enough to debug a failed run, not as a permanent log.
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 },
  },
});
