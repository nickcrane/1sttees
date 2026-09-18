import { z } from "zod";
import { env } from "@/lib/env";
import type {
  CapturedPayment,
  CreateIntentInput,
  CreateIntentResult,
  ParsedPaymentEvent,
  PaymentProvider,
} from "@/lib/payments/types";

function baseUrl(): string {
  return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  }
  return { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET };
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

// Cached in-process; a client-credentials token is valid for the process's
// lifetime worth of requests (PayPal issues them for ~9h) and re-fetching
// per request would needlessly double every call's latency.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = requireCredentials();
  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new Error(`PayPal OAuth token request failed: ${response.status} ${await response.text()}`);
  }

  const parsed = tokenResponseSchema.parse(await response.json());
  // Refresh a minute early rather than racing the exact expiry instant.
  cachedToken = { value: parsed.access_token, expiresAt: Date.now() + (parsed.expires_in - 60) * 1000 };
  return parsed.access_token;
}

async function paypalFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`PayPal API request failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const createOrderResponseSchema = z.object({
  id: z.string(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })),
});

const captureResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z.array(
    z.object({
      payments: z.object({
        captures: z.array(
          z.object({
            id: z.string(),
            status: z.string(),
            amount: z.object({ value: z.string(), currency_code: z.string() }),
            payment_source_brand: z.string().optional(),
          })
        ),
      }),
    })
  ),
});

const orderDetailResponseSchema = z.object({
  id: z.string(),
  purchase_units: z.array(
    z.object({
      payments: z.object({
        captures: z.array(z.object({ id: z.string() })).optional(),
      }),
    })
  ),
});

function minorToDecimalString(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export const paypalProvider: PaymentProvider = {
  kind: "PAYPAL",

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: input.orderNumber,
          amount: { currency_code: input.currency, value: minorToDecimalString(input.amountMinor) },
        },
      ],
      application_context: {
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        user_action: "PAY_NOW",
      },
    };

    const raw = await paypalFetch("/v2/checkout/orders", { method: "POST", body: JSON.stringify(body) });
    const order = createOrderResponseSchema.parse(raw);
    const approveUrl = order.links.find((link) => link.rel === "approve")?.href;

    return { providerRef: order.id, approveUrl };
  },

  async capture(providerRef: string): Promise<CapturedPayment> {
    const raw = await paypalFetch(`/v2/checkout/orders/${providerRef}/capture`, { method: "POST" });
    const result = captureResponseSchema.parse(raw);
    const capture = result.purchase_units[0]?.payments.captures[0];
    if (!capture) {
      throw new Error(`PayPal capture response for order ${providerRef} had no capture entry`);
    }

    return {
      providerRef: result.id,
      status: capture.status === "COMPLETED" ? "succeeded" : "failed",
      amountMinor: Math.round(Number.parseFloat(capture.amount.value) * 100),
      currency: capture.amount.currency_code,
      paymentMethodBrand: capture.payment_source_brand?.toLowerCase(),
    };
  },

  async refund(providerRef: string, amountMinor?: number): Promise<void> {
    const raw = await paypalFetch(`/v2/checkout/orders/${providerRef}`);
    const order = orderDetailResponseSchema.parse(raw);
    const captureId = order.purchase_units[0]?.payments.captures?.[0]?.id;
    if (!captureId) {
      throw new Error(`No capture found for PayPal order ${providerRef} -- has it been captured yet?`);
    }

    const body = amountMinor !== undefined ? { amount: { value: minorToDecimalString(amountMinor), currency_code: "GBP" } } : {};
    await paypalFetch(`/v2/payments/captures/${captureId}/refund`, { method: "POST", body: JSON.stringify(body) });
  },

  async parseWebhookEvent(rawBody: string, headers: Headers): Promise<ParsedPaymentEvent | null> {
    if (!env.PAYPAL_WEBHOOK_ID) {
      throw new Error("PAYPAL_WEBHOOK_ID is not set");
    }

    const event = JSON.parse(rawBody) as { id: string; event_type: string; resource?: { id?: string } };

    const verifyBody = {
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_time: headers.get("paypal-transmission-time"),
      cert_url: headers.get("paypal-cert-url"),
      auth_algo: headers.get("paypal-auth-algo"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody),
    };

    const verification = z
      .object({ verification_status: z.string() })
      .parse(await paypalFetch("/v1/notifications/verify-webhook-signature", { method: "POST", body: JSON.stringify(verifyBody) }));

    if (verification.verification_status !== "SUCCESS") return null;

    const providerRef = event.resource?.id ?? "";
    if (event.event_type === "PAYMENT_CAPTURE_COMPLETED" || event.event_type === "CHECKOUT.ORDER.APPROVED") {
      return { type: "payment_succeeded", providerRef, providerEventId: event.id, raw: event };
    }
    if (event.event_type === "PAYMENT_CAPTURE_DENIED" || event.event_type === "PAYMENT_CAPTURE_DECLINED") {
      return { type: "payment_failed", providerRef, providerEventId: event.id, raw: event };
    }
    return { type: "other", providerEventId: event.id, raw: event };
  },
};
