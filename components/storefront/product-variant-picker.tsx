"use client";

import { CheckIcon, MinusIcon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { addToCartAction } from "@/lib/cart/actions";
import { formatMinor } from "@/lib/money";

export interface VariantOption {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
}

export function ProductVariantPicker({ variants }: { variants: VariantOption[] }) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const selected = variants.find((variant) => variant.id === selectedId) ?? variants[0];

  return (
    <form action={addToCartAction} className="flex flex-col gap-6">
      <input type="hidden" name="quantity" value={quantity} />

      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-label-lg text-muted-foreground">Size</legend>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => {
            const isSelected = selectedId === variant.id;
            return (
              <label key={variant.id} className="cursor-pointer">
                <input
                  type="radio"
                  name="productVariantId"
                  value={variant.id}
                  checked={isSelected}
                  onChange={() => setSelectedId(variant.id)}
                  className="peer sr-only"
                />
                {/* Material 3 choice chip: outlined + unfilled by default, tonal fill + leading check when selected. */}
                <span
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-4 text-label-lg transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 ${
                    isSelected
                      ? "border-transparent bg-secondary-container text-on-secondary-container"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {isSelected && <CheckIcon className="size-4" />}
                  {variant.title}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {selected && (
        <p className="text-headline-sm text-primary">{formatMinor(selected.priceMinor, selected.currency)}</p>
      )}

      <div className="flex flex-col gap-2.5">
        <span className="text-label-lg text-muted-foreground">Quantity</span>
        <div className="inline-flex h-10 w-fit items-center rounded-full border border-border">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <MinusIcon className="size-4" />
          </button>
          <span className="w-8 text-center text-title-md tabular-nums" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            aria-label="Increase quantity"
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={!selected}
        // text-primary-foreground repeated explicitly: confirmed live
        // (Lighthouse color-contrast audit, 2.61 vs 4.5 required) that
        // Tailwind's class-merge logic doesn't recognize the custom
        // text-title-md font-size token and treats it as conflicting with
        // Button's own `text-primary-foreground`, dropping it -- the
        // button silently rendered dark text on its dark-green background.
        className="h-12 gap-2 self-stretch rounded-full text-title-md text-primary-foreground shadow-el1 sm:self-start sm:px-8"
      >
        <ShoppingBagIcon className="size-5" />
        Add to cart
      </Button>
    </form>
  );
}
