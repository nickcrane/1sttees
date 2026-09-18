import { prisma } from "@/lib/prisma";
import { readCartIdFromCookie, writeCartIdCookie } from "@/lib/cart/cookie";
import type { Cart, CartItem, Product, ProductVariant } from "@prisma/client";

export type CartItemWithProduct = CartItem & {
  productVariant: ProductVariant & { product: Product };
};

export type CartWithItems = Cart & { items: CartItemWithProduct[] };

const cartInclude = {
  items: {
    include: { productVariant: { include: { product: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

async function findCartById(cartId: string): Promise<CartWithItems | null> {
  return prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
}

/**
 * Reads the cart from the signed cookie if present and still exists in the
 * DB; otherwise creates a fresh cart and writes a new cookie for it. Must
 * run somewhere `cookies().set` is allowed (a Route Handler or Server
 * Action) -- Next.js throws if called from a plain Server Component render.
 */
export async function getOrCreateCart(): Promise<CartWithItems> {
  const existingId = await readCartIdFromCookie();
  if (existingId) {
    const existing = await findCartById(existingId);
    if (existing) return existing;
  }

  const created = await prisma.cart.create({ data: {} });
  await writeCartIdCookie(created.id);
  return { ...created, items: [] };
}

/**
 * Read-only lookup for contexts that can't write cookies (e.g. rendering
 * cart contents in a Server Component) -- returns null rather than
 * creating a cart, since there's nowhere to persist its cookie from here.
 */
export async function getCart(): Promise<CartWithItems | null> {
  const cartId = await readCartIdFromCookie();
  if (!cartId) return null;
  return findCartById(cartId);
}

export async function addCartItem(
  cartId: string,
  productVariantId: string,
  quantity: number
): Promise<CartWithItems> {
  if (quantity <= 0) {
    throw new Error("quantity must be positive");
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: productVariantId },
    include: { product: true },
  });
  if (!variant || variant.product.status !== "PUBLISHED") {
    throw new Error("product variant not found or not available");
  }

  await prisma.cartItem.upsert({
    where: { cartId_productVariantId: { cartId, productVariantId } },
    create: { cartId, productVariantId, quantity },
    update: { quantity: { increment: quantity } },
  });

  const cart = await findCartById(cartId);
  if (!cart) throw new Error("cart not found after adding item");
  return cart;
}

export async function updateCartItemQuantity(
  cartId: string,
  cartItemId: string,
  quantity: number
): Promise<CartWithItems> {
  if (quantity <= 0) {
    return removeCartItem(cartId, cartItemId);
  }

  // `cartId` filters alongside the unique `id` so an item id from a
  // different cart (guessed or stale) can't be mutated cross-cart.
  await prisma.cartItem.update({
    where: { id: cartItemId, cartId },
    data: { quantity },
  });

  const cart = await findCartById(cartId);
  if (!cart) throw new Error("cart not found after updating item");
  return cart;
}

export async function removeCartItem(cartId: string, cartItemId: string): Promise<CartWithItems> {
  await prisma.cartItem.delete({ where: { id: cartItemId, cartId } });

  const cart = await findCartById(cartId);
  if (!cart) throw new Error("cart not found after removing item");
  return cart;
}

/** Empties a cart's items without deleting the Cart row itself -- called after an order is placed from it. */
export async function clearCart(cartId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId } });
}

export interface CartTotals {
  itemCount: number;
  subtotalMinor: number;
  currency: string;
}

export function calculateCartTotals(cart: CartWithItems): CartTotals {
  let itemCount = 0;
  let subtotalMinor = 0;
  for (const item of cart.items) {
    itemCount += item.quantity;
    subtotalMinor += item.productVariant.priceMinor * item.quantity;
  }
  return {
    itemCount,
    subtotalMinor,
    currency: cart.items[0]?.productVariant.currency ?? "GBP",
  };
}
