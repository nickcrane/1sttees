import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// cuid()s (Cart.id) never contain "." so it's a safe, unambiguous separator
// between the id and its signature -- no need to escape/encode the id itself.
const SEPARATOR = ".";

function sign(cartId: string): string {
  return createHmac("sha256", env.CART_COOKIE_SECRET).update(cartId).digest("base64url");
}

/** Cookie value: `<cartId>.<hmac>` -- the id is plaintext (not a secret), only tamper-proofed. */
export function signCartId(cartId: string): string {
  return `${cartId}${SEPARATOR}${sign(cartId)}`;
}

/**
 * Returns the cart id if the cookie's signature is valid, otherwise null --
 * never throws, since a missing/forged/stale-secret cookie should just be
 * treated as "no cart", not a hard error.
 */
export function verifyCartId(value: string | undefined | null): string | null {
  if (!value) return null;
  const separatorIndex = value.lastIndexOf(SEPARATOR);
  if (separatorIndex === -1) return null;

  const cartId = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  const expected = sign(cartId);

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch rather than returning false --
  // check lengths first so a short/forged signature doesn't crash the request.
  if (expectedBuf.length !== signatureBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null;

  return cartId;
}
