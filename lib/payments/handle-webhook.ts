import { NextResponse } from "next/server";
import { applyPaymentEvent } from "@/lib/orders/confirm-payment";
import { prisma } from "@/lib/prisma";
import type { PaymentProvider } from "@/lib/payments/types";

/**
 * Shared body for both webhook routes: verify+parse, dedup by
 * (provider, providerEventId) so a replayed delivery is a no-op, record
 * the raw event, then apply it. Kept as one function rather than
 * duplicated per route since the only thing that differs between
 * Stripe/PayPal here is which PaymentProvider does the verifying.
 */
export async function handleWebhookRequest(provider: PaymentProvider, request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const event = await provider.parseWebhookEvent(rawBody, request.headers);
  if (!event) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_providerEventId: { provider: provider.kind, providerEventId: event.providerEventId } },
  });
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  await prisma.webhookEvent.create({
    data: {
      provider: provider.kind,
      providerEventId: event.providerEventId,
      type: event.type,
      payload: JSON.parse(JSON.stringify(event.raw)),
    },
  });

  await applyPaymentEvent(event);
  await prisma.webhookEvent.updateMany({
    where: { provider: provider.kind, providerEventId: event.providerEventId },
    data: { processedAt: new Date() },
  });

  return NextResponse.json({ received: true });
}
