import type { PaymentProviderKind } from "@prisma/client";
import { paypalProvider } from "@/lib/payments/paypal";
import { stripeProvider } from "@/lib/payments/stripe";
import type { PaymentProvider } from "@/lib/payments/types";

export function getPaymentProvider(kind: PaymentProviderKind): PaymentProvider {
  if (kind === "STRIPE") return stripeProvider;
  return paypalProvider;
}

export type { CapturedPayment, CreateIntentInput, CreateIntentResult, ParsedPaymentEvent, PaymentProvider } from "@/lib/payments/types";
