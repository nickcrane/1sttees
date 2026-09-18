import type { PaymentProviderKind } from "@prisma/client";

export interface CreateIntentInput {
  orderNumber: string;
  amountMinor: number;
  currency: string;
  email: string;
  /** Where the buyer lands after an off-site step (PayPal approval, a redirect-based 3DS challenge). */
  returnUrl: string;
  cancelUrl: string;
}

export interface CreateIntentResult {
  providerRef: string;
  /** Stripe only -- handed to stripe.js on the client to confirm the PaymentIntent (drives the SCA challenge if one's required). */
  clientSecret?: string;
  /** PayPal only -- redirect the buyer here to approve the order. */
  approveUrl?: string;
}

export interface CapturedPayment {
  providerRef: string;
  status: "succeeded" | "requires_action" | "failed";
  amountMinor: number;
  currency: string;
  paymentMethodBrand?: string;
  paymentMethodLast4?: string;
}

export type ParsedPaymentEvent =
  | { type: "payment_succeeded"; providerRef: string; providerEventId: string; raw: unknown }
  | { type: "payment_failed"; providerRef: string; providerEventId: string; raw: unknown }
  | { type: "other"; providerEventId: string; raw: unknown };

export interface PaymentProvider {
  readonly kind: PaymentProviderKind;
  /** Starts a payment: a Stripe PaymentIntent, or a PayPal order (intent=CAPTURE). */
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  /**
   * Finalizes and returns the settled payment's details. For Stripe (auto-
   * capture) this retrieves the PaymentIntent's outcome after the client
   * confirms it; for PayPal this is the actual capture call, since PayPal's
   * buyer-approval step doesn't move money on its own.
   */
  capture(providerRef: string): Promise<CapturedPayment>;
  refund(providerRef: string, amountMinor?: number): Promise<void>;
  /**
   * Verifies the webhook request's signature and parses it in one step --
   * deliberately not split into separate verify/parse calls, since a parsed
   * body is only safe to act on once it's been proven to come from the
   * provider. Returns null for a request that fails verification.
   */
  parseWebhookEvent(rawBody: string, headers: Headers): Promise<ParsedPaymentEvent | null>;
}
