"use server";

import type { PaymentProviderKind } from "@prisma/client";
import { getOrCreateCart } from "@/lib/cart/cart";
import { env } from "@/lib/env";
import { attachPaymentIntent, createPendingOrder } from "@/lib/orders/create-order";
import type { AddressInput } from "@/lib/orders/types";
import { getPaymentProvider } from "@/lib/payments";

export interface StartCheckoutInput {
  email: string;
  shippingAddress: AddressInput;
  provider: PaymentProviderKind;
}

export interface StartCheckoutResult {
  orderNumber: string;
  /** Stripe only -- hand this to stripe.js to render the Payment Element. */
  clientSecret?: string;
  /** PayPal only -- redirect the browser here for the buyer to approve. */
  approveUrl?: string;
}

/**
 * Snapshots the current cart into a PENDING_PAYMENT order and starts a
 * payment with the chosen provider. The order's total is computed
 * server-side from the cart (createPendingOrder), never from anything the
 * client sent -- this function's only inputs are the buyer's contact/
 * shipping details and which provider to use.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const cart = await getOrCreateCart();
  if (cart.items.length === 0) {
    throw new Error("Your cart is empty");
  }

  const pendingOrder = await createPendingOrder({
    cartId: cart.id,
    email: input.email,
    shippingAddress: input.shippingAddress,
  });

  const paymentProvider = getPaymentProvider(input.provider);
  const intent = await paymentProvider.createIntent({
    orderNumber: pendingOrder.orderNumber,
    amountMinor: pendingOrder.totalMinor,
    currency: pendingOrder.currency,
    email: input.email,
    returnUrl: `${env.STORE_BASE_URL}/checkout/paypal-return?order=${pendingOrder.orderNumber}`,
    cancelUrl: `${env.STORE_BASE_URL}/checkout?cancelled=1`,
  });

  await attachPaymentIntent(pendingOrder.orderId, input.provider, intent.providerRef);

  return { orderNumber: pendingOrder.orderNumber, clientSecret: intent.clientSecret, approveUrl: intent.approveUrl };
}
