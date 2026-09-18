import type { NextResponse } from "next/server";
import { handleWebhookRequest } from "@/lib/payments/handle-webhook";
import { paypalProvider } from "@/lib/payments/paypal";

export async function POST(request: Request): Promise<NextResponse> {
  return handleWebhookRequest(paypalProvider, request);
}
