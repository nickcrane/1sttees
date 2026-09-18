import type { Order } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clearCart } from "@/lib/cart/cart";
import { getPaymentProvider } from "@/lib/payments";
import type { CapturedPayment, ParsedPaymentEvent } from "@/lib/payments/types";

async function markOrderPaid(order: Order, captured: CapturedPayment): Promise<void> {
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "PAID",
      paymentMethodBrand: captured.paymentMethodBrand,
      paymentMethodLast4: captured.paymentMethodLast4,
      paidAt: new Date(),
    },
  });

  if (order.cartId) await clearCart(order.cartId);
}

/**
 * Applies a verified webhook event to the order it refers to. Idempotent by
 * construction the same way WebhookEvent dedup is: looks the order up by
 * paymentProviderRef and only moves PENDING_PAYMENT -> PAID, so replaying
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
  if (order.status === "PAID") return "already_paid";
  if (order.status !== "PENDING_PAYMENT") return "failed";

  const captured = await getPaymentProvider("PAYPAL").capture(paypalOrderId);
  if (captured.status !== "succeeded") return "failed";

  await markOrderPaid(order, captured);
  return "paid";
}
