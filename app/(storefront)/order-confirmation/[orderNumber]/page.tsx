import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatusPoller } from "@/components/storefront/order-status-poller";
import { formatMinor } from "@/lib/money";
import type { AddressInput } from "@/lib/orders/types";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Order confirmation" };

interface OrderConfirmationPageProps {
  params: Promise<{ orderNumber: string }>;
}

export default async function OrderConfirmationPage({ params }: OrderConfirmationPageProps) {
  const { orderNumber } = await params;
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { items: true } });
  if (!order) notFound();

  if (order.status === "PENDING_PAYMENT") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
        <OrderStatusPoller />
        <h1 className="font-heading text-2xl font-semibold">Confirming your payment...</h1>
        <p className="text-sm text-muted-foreground">
          This usually only takes a moment. Order {order.orderNumber} -- this page will update automatically.
        </p>
      </div>
    );
  }

  if (order.status !== "PAID") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
        <h1 className="font-heading text-2xl font-semibold">We couldn&rsquo;t complete this order</h1>
        <p className="text-sm text-muted-foreground">
          Order {order.orderNumber} wasn&rsquo;t paid. No charge was made -- please try checking out again.
        </p>
      </div>
    );
  }

  const shippingAddress = order.shippingAddress as unknown as AddressInput;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-heading text-2xl font-semibold">Thank you for your order</h1>
        <p className="text-sm text-muted-foreground">
          Order {order.orderNumber} is confirmed. We&rsquo;ll be in touch at {order.email} with tracking once it ships.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border p-6">
        <ul className="flex flex-col gap-3">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{item.titleSnapshot}</p>
                <p className="text-muted-foreground">
                  {item.variantTitleSnapshot} &times; {item.quantity}
                </p>
              </div>
              <p className="font-medium whitespace-nowrap">
                {formatMinor(item.unitPriceMinor * item.quantity, order.currency)}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border pt-4 text-sm font-semibold">
          <span>Total</span>
          <span>{formatMinor(order.totalMinor, order.currency)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Shipping to</p>
        <p>{shippingAddress.name}</p>
        <p>{shippingAddress.line1}</p>
        {shippingAddress.line2 && <p>{shippingAddress.line2}</p>}
        <p>
          {shippingAddress.city}, {shippingAddress.postcode}
        </p>
        <p>{shippingAddress.country}</p>
      </div>
    </div>
  );
}
