import type { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { calculateOrderTotals } from "@/lib/orders/calculate-totals";
import { generateOrderNumber } from "@/lib/orders/order-number";
import type { AddressInput } from "@/lib/orders/types";

export interface CreatePendingOrderInput {
  cartId: string;
  email: string;
  shippingAddress: AddressInput;
  billingAddress?: AddressInput;
}

export interface CreatePendingOrderResult {
  orderId: string;
  orderNumber: string;
  totalMinor: number;
  currency: string;
}

/**
 * Creates a PENDING_PAYMENT order snapshotting the cart's current contents.
 * Amounts are always recomputed here from the live ProductVariant/
 * SupplierVariant rows -- the checkout flow must never trust a
 * client-submitted total. Doesn't touch the cart or payment state; that
 * happens once payment is confirmed (lib/orders/confirm-payment.ts, called
 * from the webhook handler), so an abandoned checkout just leaves the cart
 * as it was.
 */
export async function createPendingOrder(input: CreatePendingOrderInput): Promise<CreatePendingOrderResult> {
  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    include: {
      items: {
        include: { productVariant: { include: { product: true, supplierVariant: true } } },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw new Error("cannot create an order from an empty cart");
  }

  const unavailable = cart.items.find((item) => item.productVariant.product.status !== "PUBLISHED");
  if (unavailable) {
    throw new Error(`"${unavailable.productVariant.product.title}" is no longer available`);
  }

  const totals = calculateOrderTotals(
    cart.items.map((item) => ({
      priceMinor: item.productVariant.priceMinor,
      quantity: item.quantity,
      currency: item.productVariant.currency,
    })),
    env.VAT_MODE
  );

  const order = await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      cartId: input.cartId,
      email: input.email,
      status: "PENDING_PAYMENT",
      currency: totals.currency,
      subtotalMinor: totals.subtotalMinor,
      shippingMinor: totals.shippingMinor,
      vatMinor: totals.vatMinor,
      vatRateBps: totals.vatRateBps,
      totalMinor: totals.totalMinor,
      shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
      billingAddress: (input.billingAddress ?? input.shippingAddress) as unknown as Prisma.InputJsonValue,
      items: {
        create: cart.items.map((item) => ({
          productVariantId: item.productVariantId,
          titleSnapshot: item.productVariant.product.title,
          variantTitleSnapshot: item.productVariant.title,
          skuAttrsSnapshot: item.productVariant.supplierVariant.skuAttrs,
          unitPriceMinor: item.productVariant.priceMinor,
          quantity: item.quantity,
          supplierCostMinorSnapshot: item.productVariant.supplierVariant.supplierPriceMinor,
        })),
      },
    },
  });

  return { orderId: order.id, orderNumber: order.orderNumber, totalMinor: order.totalMinor, currency: order.currency };
}

/** Records the provider's payment reference on a still-pending order so the webhook can look the order back up by it once payment settles. */
export async function attachPaymentIntent(
  orderId: string,
  provider: "STRIPE" | "PAYPAL",
  providerRef: string
): Promise<void> {
  await prisma.order.update({
    where: { id: orderId },
    data: { paymentProvider: provider, paymentProviderRef: providerRef },
  });
}
