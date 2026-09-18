import Link from "next/link";
import { CartDrawer, type CartDrawerItem } from "@/components/storefront/cart-drawer";
import { calculateCartTotals, getCart } from "@/lib/cart/cart";
import { auth } from "@/lib/customer-auth/config";

export async function Header() {
  const [cart, session] = await Promise.all([getCart(), auth()]);

  const items: CartDrawerItem[] =
    cart?.items.map((item) => ({
      id: item.id,
      title: item.productVariant.product.title,
      variantTitle: item.productVariant.title,
      quantity: item.quantity,
      priceMinor: item.productVariant.priceMinor,
      currency: item.productVariant.currency,
    })) ?? [];

  const totals = cart ? calculateCartTotals(cart) : { itemCount: 0, subtotalMinor: 0, currency: "GBP" };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-heading text-lg font-semibold">
          1st Tees
        </Link>
        <nav className="flex items-center gap-4">
          <Link href="/products" className="text-sm text-muted-foreground hover:text-foreground">
            Shop
          </Link>
          <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground">
            {session ? "My account" : "Sign in"}
          </Link>
          <CartDrawer
            items={items}
            itemCount={totals.itemCount}
            subtotalMinor={totals.subtotalMinor}
            currency={totals.currency}
          />
        </nav>
      </div>
    </header>
  );
}
