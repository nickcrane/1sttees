"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const selected = variants.find((variant) => variant.id === selectedId) ?? variants[0];

  return (
    <form action={addToCartAction} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Size</legend>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => (
            <label key={variant.id} className="cursor-pointer">
              <input
                type="radio"
                name="productVariantId"
                value={variant.id}
                checked={selectedId === variant.id}
                onChange={() => setSelectedId(variant.id)}
                className="peer sr-only"
              />
              <span className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm peer-checked:border-primary peer-checked:bg-primary/10 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
                {variant.title}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {selected && <p className="text-2xl font-semibold">{formatMinor(selected.priceMinor, selected.currency)}</p>}

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quantity">Quantity</Label>
          <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} className="w-20" />
        </div>
        <Button type="submit" size="lg" disabled={!selected}>
          Add to cart
        </Button>
      </div>
    </form>
  );
}
