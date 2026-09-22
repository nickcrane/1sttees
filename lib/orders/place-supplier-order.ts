import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressApiError } from "@/lib/aliexpress/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { AddressInput } from "@/lib/orders/types";
import { findValidationFailure } from "@/lib/orders/validate-fulfilment";

const aliExpressClient = new AliExpressClient();

export class PlaceSupplierOrderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PlaceSupplierOrderError";
    this.retryable = retryable;
  }
}

function buildLogisticsAddress(shippingAddress: AddressInput) {
  return {
    address: shippingAddress.line2 ? `${shippingAddress.line1}, ${shippingAddress.line2}` : shippingAddress.line1,
    city: shippingAddress.city,
    // AliExpress's DS API wants a province/region -- our checkout doesn't
    // collect one (UK/EU addresses are usually fine with just city +
    // postcode), so this is deliberately blank rather than a guess.
    // Revisit if a real placement is ever rejected for a missing province.
    province: "",
    country: shippingAddress.country,
    contactPerson: shippingAddress.name,
    fullName: shippingAddress.name,
    zip: shippingAddress.postcode,
  };
}

function loadOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: { productVariant: { include: { product: true, supplierVariant: { include: { supplierProduct: true } } } } },
      },
    },
  });
}

/**
 * Places the AliExpress order(s) for an order that's past its
 * cancellation hold. `tryToPay` stays false (the default) -- the
 * auto-pay whitelist isn't confirmed yet (see docs/decisions.md), so a
 * successfully *placed* order still needs a human to pay for it on
 * AliExpress's own site. SUPPLIER_ORDER_PLACED means "placed with the
 * supplier", not "paid to the supplier" -- the admin orders view is what
 * surfaces "placed, needs manual payment".
 *
 * Idempotent and crash-safe: if supplierOrderIds is already populated,
 * this is a no-op (a previous attempt succeeded; only the local status
 * update might have failed to persist -- self-heals it instead of
 * calling AliExpress again). Otherwise, HOLD *and* SUPPLIER_ORDER_QUEUED
 * are both valid trigger states -- QUEUED covers a worker that crashed
 * between setting that status and getting AliExpress's response, so the
 * natural retry (BullMQ's stalled-job recovery, or a manual re-run) can
 * still make progress instead of being silently skipped by a guard that
 * only accepted the pre-attempt status.
 */
export async function placeSupplierOrder(orderId: string): Promise<void> {
  const order = await loadOrder(orderId);

  if (!order) {
    throw new PlaceSupplierOrderError(`Order ${orderId} not found`, false);
  }

  if (order.supplierOrderIds.length > 0) {
    if (order.status !== "SUPPLIER_ORDER_PLACED") {
      await prisma.order.update({ where: { id: order.id }, data: { status: "SUPPLIER_ORDER_PLACED" } });
    }
    logger.info({ orderId, supplierOrderIds: order.supplierOrderIds }, "placeSupplierOrder: already placed, skipping");
    return;
  }

  if (order.status !== "HOLD" && order.status !== "SUPPLIER_ORDER_QUEUED") {
    logger.info({ orderId, status: order.status }, "placeSupplierOrder: order is not HOLD/QUEUED, skipping");
    return;
  }

  const validationFailure = findValidationFailure(
    order.items.map((item) => ({
      titleSnapshot: item.titleSnapshot,
      productStatus: item.productVariant.product.status,
      currentSupplierPriceMinor: item.productVariant.supplierVariant.supplierPriceMinor,
      supplierCostMinorSnapshot: item.supplierCostMinorSnapshot,
    })),
    env.PRICE_DRIFT_TOLERANCE_PCT
  );
  if (validationFailure) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "NEEDS_MANUAL_REVIEW", fulfilmentError: validationFailure },
    });
    await prisma.auditLog.create({
      data: {
        actorType: "SYSTEM",
        action: "SUPPLIER_ORDER_VALIDATION_FAILED",
        entityType: "Order",
        entityId: order.id,
        after: { reason: validationFailure },
      },
    });
    return;
  }

  await prisma.order.update({ where: { id: order.id }, data: { status: "SUPPLIER_ORDER_QUEUED" } });

  const shippingAddress = order.shippingAddress as unknown as AddressInput;

  try {
    const result = await aliExpressClient.placeOrder({
      outOrderId: order.orderNumber,
      logisticsAddress: buildLogisticsAddress(shippingAddress),
      items: order.items.map((item) => ({
        productId: item.productVariant.supplierVariant.supplierProduct.aeProductId,
        productCount: item.quantity,
        skuAttr: item.skuAttrsSnapshot,
      })),
      tryToPay: false,
    });

    if (!result.isSuccess) {
      throw new PlaceSupplierOrderError(
        result.errorMessage ?? `AliExpress rejected the order (${result.errorCode ?? "unknown error"})`,
        false
      );
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "SUPPLIER_ORDER_PLACED",
        supplierOrderIds: result.orderIds,
        supplierOrderPlacedAt: new Date(),
        fulfilmentError: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorType: "SYSTEM",
        action: "SUPPLIER_ORDER_PLACED",
        entityType: "Order",
        entityId: order.id,
        after: { supplierOrderIds: result.orderIds },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error placing the supplier order";
    const retryable = error instanceof AliExpressApiError ? error.detail.retryable : false;

    await prisma.order.update({
      where: { id: order.id },
      // Revert to HOLD (not PAID -- HOLD is the trigger status now) on a
      // retryable failure, so the next attempt's guard above accepts it.
      data: {
        status: retryable ? "HOLD" : "NEEDS_MANUAL_REVIEW",
        fulfilmentError: message,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorType: "SYSTEM",
        action: "SUPPLIER_ORDER_PLACEMENT_FAILED",
        entityType: "Order",
        entityId: order.id,
        after: { error: message, retryable },
      },
    });

    // Only throw for a retryable failure -- BullMQ retries a thrown job
    // error with backoff, but retrying a non-retryable one (a bad
    // product id, a business rejection) would just spam AliExpress
    // identically every time. A non-retryable failure has already done
    // everything it needs to (NEEDS_MANUAL_REVIEW + the audit log above),
    // so returning normally here marks the job done, not failed.
    if (retryable) {
      throw new PlaceSupplierOrderError(message, retryable);
    }
  }
}
