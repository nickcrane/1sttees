import type { Order } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clearCart } from "@/lib/cart/cart";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import { capturedAmountMatchesOrder } from "@/lib/payments/amount-matches";
import type { CapturedPayment, ParsedPaymentEvent } from "@/lib/payments/types";
import { enqueuePlaceSupplierOrder } from "@/lib/queue/fulfilment-queue";

async function flagAmountMismatch(order: Order, captured: CapturedPayment): Promise<void> {
  const message = `Captured payment ${captured.amountMinor} ${captured.currency} does not match order total ${order.totalMinor} ${order.currency}`;
  await prisma.order.update({
    where: { id: order.id },
    data: { status: "NEEDS_MANUAL_REVIEW", fulfilmentError: message },
  });
  await prisma.auditLog.create({
    data: {
      actorType: "SYSTEM",
      action: "PAYMENT_AMOUNT_MISMATCH",
      entityType: "Order",
      entityId: order.id,
      after: {
        capturedAmountMinor: captured.amountMinor,
        capturedCurrency: captured.currency,
        orderTotalMinor: order.totalMinor,
        orderCurrency: order.currency,
      },
    },
  });
}

async function markOrderPaid(order: Order, captured: CapturedPayment): Promise<void> {
  // HOLD, not PAID -- spec: "an order-cancellation window in the admin
  // before the supplier order is placed" (default ORDER_HOLD_MINUTES,
  // configurable). paidAt/brand/last4 are the durable record that payment
  // happened; the *status* moves straight through PAID to HOLD since
  // nothing meaningful happens while it's literally "PAID" for its own
  // sake -- the hold window is the real waiting state.
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "HOLD",
      paymentMethodBrand: captured.paymentMethodBrand,
      paymentMethodLast4: captured.paymentMethodLast4,
      paidAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "SYSTEM",
      action: "ORDER_PAID",
      entityType: "Order",
      entityId: order.id,
      after: { paymentMethodBrand: captured.paymentMethodBrand, paymentMethodLast4: captured.paymentMethodLast4 },
    },
  });

  if (order.cartId) await clearCart(order.cartId);

  // Delayed, not enqueued immediately -- this is what actually makes the
  // HOLD window real. place-supplier-order.ts re-checks the order is
  // still HOLD (not CANCELLED by an admin in the meantime) when the delay
  // elapses.
  await enqueuePlaceSupplierOrder(order.id, env.ORDER_HOLD_MINUTES * 60_000);
}

/**
 * Applies a verified webhook event to the order it refers to. Idempotent by
 * construction the same way WebhookEvent dedup is: looks the order up by
 * paymentProviderRef and only moves PENDING_PAYMENT -> HOLD, so replaying
 * an event (Stripe/PayPal retry, or our own dedup failing open) against an
 * already-settled order is a no-op rather than double-processing it.
 */
export async function applyPaymentEvent(event: ParsedPaymentEvent): Promise<void> {
  if (event.type === "other") return;

  const order = await prisma.order.findUnique({ where: { paymentProviderRef: event.providerRef } });
  if (!order) return;
  if (order.status !== "PENDING_PAYMENT") return;

  if (event.type === "payment_failed") {
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    return;
  }

  const provider = getPaymentProvider(order.paymentProvider ?? "STRIPE");
  const captured = await provider.capture(event.providerRef);
  if (captured.status !== "succeeded") return;

  if (!capturedAmountMatchesOrder(order, captured)) {
    await flagAmountMismatch(order, captured);
    return;
  }

  await markOrderPaid(order, captured);
}

/**
 * Captures a PayPal order once the buyer's browser returns from approving
 * it. Unlike Stripe's capture() (a read-only retrieve), PayPal's capture is
 * a state-changing call that errors if made twice -- so this checks the
 * order's status BEFORE calling it, since the webhook can legitimately win
 * the race and capture first. Never calls PayPal's capture endpoint when
 * the order isn't still PENDING_PAYMENT.
 */
export async function capturePaypalReturn(
  orderNumber: string,
  paypalOrderId: string
): Promise<"paid" | "already_paid" | "failed"> {
  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order || order.paymentProvider !== "PAYPAL" || order.paymentProviderRef !== paypalOrderId) {
    return "failed";
  }
  // Not just `=== "PAID"` -- PAID is a transient step straight through to
  // HOLD now (see markOrderPaid), so an order the webhook already won the
  // race on will be sitting at HOLD or later, not PAID.
  if (order.status !== "PENDING_PAYMENT") return "already_paid";

  const captured = await getPaymentProvider("PAYPAL").capture(paypalOrderId);
  if (captured.status !== "succeeded") return "failed";

  if (!capturedAmountMatchesOrder(order, captured)) {
    await flagAmountMismatch(order, captured);
    return "failed";
  }

  await markOrderPaid(order, captured);
  return "paid";
}
