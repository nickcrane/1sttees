"use client";

import { ShoppingBagIcon } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { removeCartItemAction, updateCartItemAction } from "@/lib/cart/actions";
import { formatMinor } from "@/lib/money";

export interface CartDrawerItem {
  id: string;
  title: string;
  variantTitle: string;
  quantity: number;
  priceMinor: number;
  currency: string;
}

export interface CartDrawerProps {
  items: CartDrawerItem[];
  itemCount: number;
  subtotalMinor: number;
  currency: string;
}

export function CartDrawer({ items, itemCount, subtotalMinor, currency }: CartDrawerProps) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`} />
        }
      >
        <span className="relative">
          <ShoppingBagIcon />
          {itemCount > 0 && (
            <span className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {itemCount}
            </span>
          )}
        </span>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Your cart</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Your cart is empty.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.variantTitle}</p>
                    </div>
                    <p className="text-sm font-medium">
                      {formatMinor(item.priceMinor * item.quantity, item.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={updateCartItemAction}>
                      <input type="hidden" name="cartItemId" value={item.id} />
                      <input type="hidden" name="quantity" value={item.quantity - 1} />
                      <Button type="submit" variant="outline" size="icon-xs" aria-label="Decrease quantity">
                        −
                      </Button>
                    </form>
                    <span className="w-6 text-center text-sm">{item.quantity}</span>
                    <form action={updateCartItemAction}>
                      <input type="hidden" name="cartItemId" value={item.id} />
                      <input type="hidden" name="quantity" value={item.quantity + 1} />
                      <Button type="submit" variant="outline" size="icon-xs" aria-label="Increase quantity">
                        +
                      </Button>
                    </form>
                    <form action={removeCartItemAction} className="ml-auto">
                      <input type="hidden" name="cartItemId" value={item.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Remove
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <SheetFooter>
            <Separator />
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Subtotal</span>
              <span>{formatMinor(subtotalMinor, currency)}</span>
            </div>
            <SheetClose
              nativeButton={false}
              render={<Link href="/checkout" className={buttonVariants({ className: "w-full justify-center" })} />}
            >
              Checkout
            </SheetClose>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
