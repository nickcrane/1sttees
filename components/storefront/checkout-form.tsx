"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import { StripePaymentForm } from "@/components/storefront/stripe-payment-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startCheckout } from "@/lib/orders/checkout-actions";
import type { AddressInput } from "@/lib/orders/types";

const SHIP_TO_COUNTRIES = [
  { code: "GB", label: "United Kingdom" },
  { code: "IE", label: "Ireland" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "NL", label: "Netherlands" },
];

const EMPTY_ADDRESS: AddressInput = { name: "", line1: "", line2: "", city: "", postcode: "", country: "GB" };

export interface CheckoutFormProps {
  stripePublishableKey?: string;
  paypalEnabled: boolean;
}

export function CheckoutForm({ stripePublishableKey, paypalEnabled }: CheckoutFormProps) {
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<AddressInput>(EMPTY_ADDRESS);
  const [submitting, setSubmitting] = useState<"STRIPE" | "PAYPAL" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ orderNumber: string; clientSecret: string } | null>(null);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (payment && stripePublishableKey ? loadStripe(stripePublishableKey) : null),
    [payment, stripePublishableKey]
  );

  async function handleSubmit(provider: "STRIPE" | "PAYPAL") {
    setError(null);

    if (!email || !address.name || !address.line1 || !address.city || !address.postcode) {
      setError("Please fill in your email and shipping address.");
      return;
    }

    setSubmitting(provider);
    try {
      const result = await startCheckout({ email, shippingAddress: address, provider });
      if (result.approveUrl) {
        window.location.href = result.approveUrl;
        return;
      }
      if (result.clientSecret) {
        setPayment({ orderNumber: result.orderNumber, clientSecret: result.clientSecret });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong -- please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (payment && stripePromise) {
    return <StripePaymentForm stripePromise={stripePromise} clientSecret={payment.clientSecret} orderNumber={payment.orderNumber} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Shipping address</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            value={address.name}
            onChange={(e) => setAddress((a) => ({ ...a, name: e.target.value }))}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line1">Address line 1</Label>
          <Input
            id="line1"
            autoComplete="address-line1"
            value={address.line1}
            onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line2">Address line 2 (optional)</Label>
          <Input
            id="line2"
            autoComplete="address-line2"
            value={address.line2 ?? ""}
            onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">Town / City</Label>
            <Input
              id="city"
              autoComplete="address-level2"
              value={address.city}
              onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="postcode">Postcode</Label>
            <Input
              id="postcode"
              autoComplete="postal-code"
              value={address.postcode}
              onChange={(e) => setAddress((a) => ({ ...a, postcode: e.target.value }))}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">Country</Label>
          <Select
            value={address.country}
            onValueChange={(value) => value && setAddress((a) => ({ ...a, country: value }))}
          >
            <SelectTrigger id="country" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHIP_TO_COUNTRIES.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-3">
        <Button size="lg" disabled={submitting !== null} onClick={() => handleSubmit("STRIPE")}>
          {submitting === "STRIPE" ? "Starting payment..." : "Pay with card"}
        </Button>
        {paypalEnabled && (
          <Button size="lg" variant="outline" disabled={submitting !== null} onClick={() => handleSubmit("PAYPAL")}>
            {submitting === "PAYPAL" ? "Redirecting to PayPal..." : "Pay with PayPal"}
          </Button>
        )}
      </div>
    </div>
  );
}
