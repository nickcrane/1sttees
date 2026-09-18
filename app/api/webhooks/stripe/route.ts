import type { NextResponse } from "next/server";
import { handleWebhookRequest } from "@/lib/payments/handle-webhook";
import { stripeProvider } from "@/lib/payments/stripe";

export async function POST(request: Request): Promise<NextResponse> {
  return handleWebhookRequest(stripeProvider, request);
}
