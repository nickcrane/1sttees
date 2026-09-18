import { NextResponse } from "next/server";
import { capturePaypalReturn } from "@/lib/orders/confirm-payment";
import { env } from "@/lib/env";

// PayPal redirects the buyer's browser here after they approve the order
// (return_url from createIntent) with `order` (our order number) and
// `token` (PayPal's order id) as query params.
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("order");
  const paypalOrderId = url.searchParams.get("token");

  if (!orderNumber || !paypalOrderId) {
    return NextResponse.redirect(new URL("/checkout?cancelled=1", env.STORE_BASE_URL));
  }

  const result = await capturePaypalReturn(orderNumber, paypalOrderId);
  if (result === "failed") {
    return NextResponse.redirect(new URL("/checkout?cancelled=1", env.STORE_BASE_URL));
  }

  return NextResponse.redirect(new URL(`/order-confirmation/${orderNumber}`, env.STORE_BASE_URL));
}
