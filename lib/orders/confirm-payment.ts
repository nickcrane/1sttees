import { prisma } from "@/lib/prisma";
import { clearCart } from "@/lib/cart/cart";
import { getPaymentProvider } from "@/lib/payments";
import type { ParsedPaymentEvent } from "@/lib/payments/types";

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
