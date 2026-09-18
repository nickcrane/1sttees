"use server";

import { revalidatePath } from "next/cache";
import { addCartItem, getOrCreateCart, removeCartItem, updateCartItemQuantity } from "@/lib/cart/cart";

function parseQuantity(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export async function addToCartAction(formData: FormData): Promise<void> {
  const productVariantId = String(formData.get("productVariantId") ?? "");
  const quantity = parseQuantity(formData.get("quantity"), 1);
  if (!productVariantId || quantity <= 0) {
    throw new Error("invalid add-to-cart request");
  }

  const cart = await getOrCreateCart();
  await addCartItem(cart.id, productVariantId, quantity);
  // The cart drawer lives in the root layout (every route), so a layout-wide
  // revalidate is what actually refreshes its item count/contents.
  revalidatePath("/", "layout");
}

export async function updateCartItemAction(formData: FormData): Promise<void> {
  const cartItemId = String(formData.get("cartItemId") ?? "");
  const quantity = parseQuantity(formData.get("quantity"), 0);
  if (!cartItemId) {
    throw new Error("invalid cart update request");
  }

  const cart = await getOrCreateCart();
  await updateCartItemQuantity(cart.id, cartItemId, quantity);
  revalidatePath("/", "layout");
}

export async function removeCartItemAction(formData: FormData): Promise<void> {
  const cartItemId = String(formData.get("cartItemId") ?? "");
  if (!cartItemId) {
    throw new Error("invalid cart remove request");
  }

  const cart = await getOrCreateCart();
  await removeCartItem(cart.id, cartItemId);
  revalidatePath("/", "layout");
}
