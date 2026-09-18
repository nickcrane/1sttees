import { cookies } from "next/headers";
import { signCartId, verifyCartId } from "@/lib/cart/signed-cart-id";

// Matches the admin-session cookie's convention (lib/admin-auth/edge-config.ts):
// __Host- requires Secure, which the browser silently refuses to honour over
// plain http://localhost in dev -- so only use the hardened prefix in prod.
const isProduction = process.env.NODE_ENV === "production";

export const CART_COOKIE_NAME = isProduction ? "__Host-cart-id" : "cart-id";

const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProduction,
  path: "/",
  maxAge: NINETY_DAYS_SECONDS,
};

export async function readCartIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  return verifyCartId(store.get(CART_COOKIE_NAME)?.value);
}

export async function writeCartIdCookie(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, signCartId(cartId), COOKIE_OPTIONS);
}

export async function clearCartIdCookie(): Promise<void> {
  const store = await cookies();
  store.delete(CART_COOKIE_NAME);
}
