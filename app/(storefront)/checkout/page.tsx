import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { calculateCartTotals, getCart } from "@/lib/cart/cart";
import { env } from "@/lib/env";
import { formatMinor } from "@/lib/money";

export const metadata: Metadata = { title: "Checkout | 1st Tees" };

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { cancelled } = await searchParams;
  const cart = await getCart();
  if (!cart || cart.items.length === 0) {
    redirect("/products");
  }

  const totals = calculateCartTotals(cart);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-4 py-12 md:grid-cols-2">
      <div>
        <h1 className="mb-6 font-heading text-2xl font-semibold">Checkout</h1>
        {cancelled && (
          <p className="mb-4 rounded-lg border border-border bg-muted px-3 py-2 text-sm">
            Payment was cancelled -- your details below are unchanged, try again when you&rsquo;re ready.
          </p>
        )}
        <CheckoutForm stripePublishableKey={env.STRIPE_PUBLISHABLE_KEY} paypalEnabled={Boolean(env.PAYPAL_CLIENT_ID)} />
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border p-6">
        <h2 className="font-heading text-lg font-semibold">Order summary</h2>
        <ul className="flex flex-col gap-3">
          {cart.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{item.productVariant.product.title}</p>
                <p className="text-muted-foreground">
                  {item.productVariant.title} &times; {item.quantity}
                </p>
              </div>
              <p className="font-medium whitespace-nowrap">
                {formatMinor(item.productVariant.priceMinor * item.quantity, item.productVariant.currency)}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border pt-4 text-sm font-semibold">
          <span>Total</span>
          <span>{formatMinor(totals.subtotalMinor, totals.currency)}</span>
        </div>
      </div>
    </div>
  );
}
