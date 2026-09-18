import Stripe from "stripe";
import { env } from "@/lib/env";
import type {
  CapturedPayment,
  CreateIntentInput,
  CreateIntentResult,
  ParsedPaymentEvent,
  PaymentProvider,
} from "@/lib/payments/types";

function getClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(env.STRIPE_SECRET_KEY);
}

function mapStatus(status: Stripe.PaymentIntent.Status): CapturedPayment["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "requires_action") return "requires_action";
  return "failed";
}

export const stripeProvider: PaymentProvider = {
  kind: "STRIPE",

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const stripe = getClient();
    // automatic_payment_methods + confirm on the client (stripe.js
    // confirmPayment) is what drives the SCA/3DS challenge when the card
    // requires it -- Stripe decides per-card, we don't branch on it here.
    const intent = await stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      receipt_email: input.email,
      automatic_payment_methods: { enabled: true },
      metadata: { orderNumber: input.orderNumber },
    });

    if (!intent.client_secret) {
      throw new Error("Stripe did not return a client_secret for the new PaymentIntent");
    }

    return { providerRef: intent.id, clientSecret: intent.client_secret };
  },

  async capture(providerRef: string): Promise<CapturedPayment> {
    const stripe = getClient();
    const intent = await stripe.paymentIntents.retrieve(providerRef, {
      expand: ["latest_charge.payment_method_details"],
    });

    const charge = intent.latest_charge;
    const card = typeof charge === "object" && charge ? charge.payment_method_details?.card : undefined;

    return {
      providerRef: intent.id,
      status: mapStatus(intent.status),
      amountMinor: intent.amount,
      currency: intent.currency.toUpperCase(),
      paymentMethodBrand: card?.brand ?? undefined,
      paymentMethodLast4: card?.last4 ?? undefined,
    };
  },

  async refund(providerRef: string, amountMinor?: number): Promise<void> {
    const stripe = getClient();
    await stripe.refunds.create({ payment_intent: providerRef, amount: amountMinor });
  },

  async parseWebhookEvent(rawBody: string, headers: Headers): Promise<ParsedPaymentEvent | null> {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    }
    const signature = headers.get("stripe-signature");
    if (!signature) return null;

    const stripe = getClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return null;
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      return { type: "payment_succeeded", providerRef: intent.id, providerEventId: event.id, raw: event };
    }
    // Deliberately NOT payment_intent.payment_failed here -- confirmed live
    // that it fires on every failed confirmation attempt (e.g. an abandoned
    // 3DS challenge), even when the SAME PaymentIntent goes on to succeed
    // moments later on a retry through the same Payment Element. Treating
    // it as terminal caused a real bug: an order got stuck CANCELLED after
    // its payment had actually succeeded, because the failed-attempt
    // webhook arrived first and applyPaymentEvent's PENDING_PAYMENT guard
    // then ignored the later payment_succeeded event. payment_intent.canceled
    // is Stripe's actual "this intent is dead, no further attempts" signal.
    if (event.type === "payment_intent.canceled") {
      const intent = event.data.object as Stripe.PaymentIntent;
      return { type: "payment_failed", providerRef: intent.id, providerEventId: event.id, raw: event };
    }
    return { type: "other", providerEventId: event.id, raw: event };
  },
};
