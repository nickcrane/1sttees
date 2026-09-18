import { beforeEach, describe, expect, it, vi } from "vitest";

// env.ts computes its `env` singleton once at import time from process.env
// (see lib/env.ts), so vi.stubEnv after that point can't change what
// stripe.ts sees -- mocking the module directly sidesteps that entirely.
vi.mock("@/lib/env", () => ({
  env: {
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_test_123",
  },
}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  refundsCreate: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class MockStripe {
    paymentIntents = { create: mocks.create, retrieve: mocks.retrieve };
    refunds = { create: mocks.refundsCreate };
    webhooks = { constructEvent: mocks.constructEvent };
  },
}));

const { stripeProvider } = await import("@/lib/payments/stripe");

beforeEach(() => {
  mocks.create.mockReset();
  mocks.retrieve.mockReset();
  mocks.refundsCreate.mockReset();
  mocks.constructEvent.mockReset();
});

describe("stripeProvider.createIntent", () => {
  it("creates a PaymentIntent and returns its client secret", async () => {
    mocks.create.mockResolvedValue({ id: "pi_123", client_secret: "pi_123_secret_abc" }); // gitleaks:allow -- fake, test-only, not a real secret

    const result = await stripeProvider.createIntent({
      orderNumber: "ORD-1",
      amountMinor: 1999,
      currency: "GBP",
      email: "buyer@example.com",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result).toEqual({ providerRef: "pi_123", clientSecret: "pi_123_secret_abc" }); // gitleaks:allow -- fake, test-only, not a real secret
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1999, currency: "gbp", metadata: { orderNumber: "ORD-1" } })
    );
  });

  it("throws if Stripe doesn't return a client_secret", async () => {
    mocks.create.mockResolvedValue({ id: "pi_123", client_secret: null });
    await expect(
      stripeProvider.createIntent({
        orderNumber: "ORD-1",
        amountMinor: 1999,
        currency: "GBP",
        email: "buyer@example.com",
        returnUrl: "https://example.com/return",
        cancelUrl: "https://example.com/cancel",
      })
    ).rejects.toThrow(/client_secret/);
  });
});

describe("stripeProvider.capture", () => {
  it("maps a succeeded PaymentIntent, including card brand/last4", async () => {
    mocks.retrieve.mockResolvedValue({
      id: "pi_123",
      status: "succeeded",
      amount: 1999,
      currency: "gbp",
      latest_charge: { payment_method_details: { card: { brand: "visa", last4: "4242" } } },
    });

    const result = await stripeProvider.capture("pi_123");

    expect(result).toEqual({
      providerRef: "pi_123",
      status: "succeeded",
      amountMinor: 1999,
      currency: "GBP",
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242",
    });
  });

  it("maps requires_action separately from a hard failure", async () => {
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "requires_action", amount: 100, currency: "gbp" });
    expect((await stripeProvider.capture("pi_1")).status).toBe("requires_action");

    mocks.retrieve.mockResolvedValue({ id: "pi_2", status: "canceled", amount: 100, currency: "gbp" });
    expect((await stripeProvider.capture("pi_2")).status).toBe("failed");
  });
});

describe("stripeProvider.refund", () => {
  it("passes the PaymentIntent id and optional amount through", async () => {
    mocks.refundsCreate.mockResolvedValue({});
    await stripeProvider.refund("pi_123", 500);
    expect(mocks.refundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_123", amount: 500 });
  });
});

describe("stripeProvider.parseWebhookEvent", () => {
  function headersWith(signature: string | null) {
    const headers = new Headers();
    if (signature) headers.set("stripe-signature", signature);
    return headers;
  }

  it("returns null when the stripe-signature header is missing", async () => {
    const result = await stripeProvider.parseWebhookEvent("{}", headersWith(null));
    expect(result).toBeNull();
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("returns null when signature verification throws", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const result = await stripeProvider.parseWebhookEvent("{}", headersWith("t=1,v1=bad"));
    expect(result).toBeNull();
  });

  it("parses a verified payment_intent.succeeded event", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123" } },
    });

    const result = await stripeProvider.parseWebhookEvent("{}", headersWith("t=1,v1=good"));
    expect(result).toMatchObject({ type: "payment_succeeded", providerRef: "pi_123", providerEventId: "evt_1" });
  });

  it("parses a verified payment_intent.canceled event as payment_failed", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_2",
      type: "payment_intent.canceled",
      data: { object: { id: "pi_456" } },
    });

    const result = await stripeProvider.parseWebhookEvent("{}", headersWith("t=1,v1=good"));
    expect(result).toMatchObject({ type: "payment_failed", providerRef: "pi_456", providerEventId: "evt_2" });
  });

  it("classifies payment_intent.payment_failed as 'other', not terminal -- the same intent can still be retried and succeed", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_5",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_789" } },
    });

    const result = await stripeProvider.parseWebhookEvent("{}", headersWith("t=1,v1=good"));
    expect(result).toMatchObject({ type: "other", providerEventId: "evt_5" });
  });

  it("classifies an unrecognized event type as 'other'", async () => {
    mocks.constructEvent.mockReturnValue({ id: "evt_3", type: "charge.refunded", data: { object: {} } });
    const result = await stripeProvider.parseWebhookEvent("{}", headersWith("t=1,v1=good"));
    expect(result).toMatchObject({ type: "other", providerEventId: "evt_3" });
  });
});
