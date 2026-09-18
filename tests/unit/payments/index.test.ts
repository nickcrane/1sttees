import { describe, expect, it } from "vitest";
import { getPaymentProvider } from "@/lib/payments";

describe("getPaymentProvider", () => {
  it("returns the Stripe provider for STRIPE", () => {
    expect(getPaymentProvider("STRIPE").kind).toBe("STRIPE");
  });

  it("returns the PayPal provider for PAYPAL", () => {
    expect(getPaymentProvider("PAYPAL").kind).toBe("PAYPAL");
  });
});
