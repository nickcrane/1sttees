#!/usr/bin/env tsx
/**
 * pnpm worker -- consumes both the fulfilment and catalog-discovery
 * queues, a separate long-running process from the Next.js web app (per
 * README: "BullMQ workers, separate entrypoint"). Relative imports rather
 * than the `@/` alias, matching the other tsx-run entrypoints
 * (scripts/ae-product.ts etc.) -- the alias is resolved by Next.js/
 * Vitest's own bundlers, not guaranteed the same way for a plain tsx
 * process, so this sticks to the already-working pattern.
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
import { CATALOG_QUEUE_NAME, CLASSIFY_PRODUCTS_JOB, DISCOVER_PRODUCTS_JOB, catalogQueue } from "../lib/queue/catalog-queue";
import { placeSupplierOrder } from "../lib/orders/place-supplier-order";
import { syncTracking } from "../lib/orders/sync-tracking";
import { runDiscovery } from "../lib/catalog/discovery";
import { classifyDiscoveredProducts } from "../lib/catalog/classify";
import { logger } from "../lib/logger";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
// Nightly, 03:00 server time -- outside any UK/EU daytime traffic, and
// clear of the 4-hourly tracking sync's own cadence.
const DISCOVERY_CRON = "0 3 * * *";
// 30 minutes after discovery -- gives that run room to finish finding/
// storing SupplierProducts before classification looks for ones to
// classify. Not a hard dependency (a slow discovery run just means
// classification picks up whatever's landed so far, and catches the rest
// next night), just a sensible offset.
const CLASSIFY_CRON = "30 3 * * *";

async function processFulfilmentJob(job: Job): Promise<void> {
  if (job.name === PLACE_SUPPLIER_ORDER_JOB) {
    const { orderId } = job.data as PlaceSupplierOrderJobData;
    await placeSupplierOrder(orderId);
    return;
  }
  if (job.name === SYNC_TRACKING_JOB) {
    await syncTracking();
    return;
  }
  logger.warn({ jobName: job.name }, "worker: unrecognized fulfilment job name, skipping");
}

async function processCatalogJob(job: Job): Promise<void> {
  if (job.name === DISCOVER_PRODUCTS_JOB) {
    await runDiscovery();
    return;
  }
  if (job.name === CLASSIFY_PRODUCTS_JOB) {
    await classifyDiscoveredProducts();
    return;
  }
  logger.warn({ jobName: job.name }, "worker: unrecognized catalog job name, skipping");
}

async function main(): Promise<void> {
  const fulfilmentWorker = new Worker(FULFILMENT_QUEUE_NAME, processFulfilmentJob, {
    connection: queueConnection,
    concurrency: 5,
  });
  const catalogWorker = new Worker(CATALOG_QUEUE_NAME, processCatalogJob, {
    connection: queueConnection,
    // Sequential -- one discovery run at a time is plenty, and it makes
    // the AliExpress rate limiter's single-process throttle (see
    // lib/aliexpress/client.ts) easier to reason about.
    concurrency: 1,
  });

  for (const worker of [fulfilmentWorker, catalogWorker]) {
    worker.on("completed", (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, "worker: job completed");
    });
    worker.on("failed", (job, error) => {
      logger.error({ jobId: job?.id, jobName: job?.name, error }, "worker: job failed");
    });
  }

  // Registers the repeatable jobs. BullMQ v6 moved this off Queue#add's old
  // `repeat` option onto a dedicated scheduler API -- upsertJobScheduler
  // dedups by jobSchedulerId, so re-registering this on every worker
  // restart updates the one schedule rather than creating duplicates.
  await fulfilmentQueue.upsertJobScheduler(SYNC_TRACKING_JOB, { every: FOUR_HOURS_MS });
  await catalogQueue.upsertJobScheduler(DISCOVER_PRODUCTS_JOB, { pattern: DISCOVERY_CRON });
  await catalogQueue.upsertJobScheduler(CLASSIFY_PRODUCTS_JOB, { pattern: CLASSIFY_CRON });

  logger.info("Fulfilment and catalog workers started");

  const shutdown = async () => {
    logger.info("Workers shutting down");
    await Promise.all([fulfilmentWorker.close(), catalogWorker.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error({ error }, "Fulfilment worker crashed");
  process.exit(1);
});
