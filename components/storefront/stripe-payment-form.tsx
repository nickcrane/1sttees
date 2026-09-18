"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { useState } from "react";
import { Button } from "@/components/ui/button";

function PayButton({ orderNumber }: { orderNumber: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    // confirmPayment drives the SCA/3DS challenge itself (a modal or
    // redirect, depending on the card's method) when the card requires
    // one -- we don't branch on that here. On success it redirects the
    // browser to return_url; it only resolves here on failure/cancellation.
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/order-confirmation/${orderNumber}` },
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed -- please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={!stripe || submitting}>
        {submitting ? "Processing..." : "Pay now"}
      </Button>
    </form>
  );
}

export interface StripePaymentFormProps {
  stripePromise: Promise<Stripe | null>;
  clientSecret: string;
  orderNumber: string;
}

export function StripePaymentForm({ stripePromise, clientSecret, orderNumber }: StripePaymentFormProps) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <PayButton orderNumber={orderNumber} />
    </Elements>
  );
}
