#!/usr/bin/env tsx
/**
 * pnpm worker -- the fulfilment queue's consumer, a separate long-running
 * process from the Next.js web app (per README: "BullMQ workers, separate
 * entrypoint"). Relative imports rather than the `@/` alias, matching the
 * other tsx-run entrypoints (scripts/ae-product.ts etc.) -- the alias is
 * resolved by Next.js/Vitest's own bundlers, not guaranteed the same way
 * for a plain tsx process, so this sticks to the already-working pattern.
 */
import { Worker, type Job } from "bullmq";
import { queueConnection } from "../lib/queue/connection";
import {
  FULFILMENT_QUEUE_NAME,
  PLACE_SUPPLIER_ORDER_JOB,
  SYNC_TRACKING_JOB,
  fulfilmentQueue,
  type PlaceSupplierOrderJobData,
} from "../lib/queue/fulfilment-queue";
import { placeSupplierOrder } from "../lib/orders/place-supplier-order";
import { syncTracking } from "../lib/orders/sync-tracking";
import { logger } from "../lib/logger";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

async function processJob(job: Job): Promise<void> {
  if (job.name === PLACE_SUPPLIER_ORDER_JOB) {
    const { orderId } = job.data as PlaceSupplierOrderJobData;
    await placeSupplierOrder(orderId);
    return;
  }
  if (job.name === SYNC_TRACKING_JOB) {
    await syncTracking();
    return;
  }
  logger.warn({ jobName: job.name }, "worker: unrecognized job name, skipping");
}

async function main(): Promise<void> {
  const worker = new Worker(FULFILMENT_QUEUE_NAME, processJob, { connection: queueConnection, concurrency: 5 });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "worker: job completed");
  });
  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, jobName: job?.name, error }, "worker: job failed");
  });

  // Registers the repeatable tracking-sync job. BullMQ v6 moved this off
  // Queue#add's old `repeat` option onto a dedicated scheduler API --
  // upsertJobScheduler dedups by jobSchedulerId, so re-registering this on
  // every worker restart updates the one schedule rather than creating
  // duplicates.
  await fulfilmentQueue.upsertJobScheduler(SYNC_TRACKING_JOB, { every: FOUR_HOURS_MS });

  logger.info("Fulfilment worker started");

  const shutdown = async () => {
    logger.info("Fulfilment worker shutting down");
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error({ error }, "Fulfilment worker crashed");
  process.exit(1);
});
