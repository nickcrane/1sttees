import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    PAYPAL_CLIENT_ID: "client-id",
    PAYPAL_CLIENT_SECRET: "client-secret",
    PAYPAL_WEBHOOK_ID: "webhook-id",
    PAYPAL_ENV: "sandbox",
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();

// The module caches its OAuth token in a module-scoped variable (see
// paypal.ts) so it survives across calls within one process -- exactly
// what production wants, but it means the module has to be reloaded fresh
// per test here, or only the first test would ever hit the token endpoint
// and every other test's mocked response sequence would be off by one.
let paypalProvider: typeof import("@/lib/payments/paypal").paypalProvider;

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  ({ paypalProvider } = await import("@/lib/payments/paypal"));
});

function mockTokenThen(...responses: Response[]) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "tok_abc", token_type: "Bearer", expires_in: 3600 }));
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
}

describe("paypalProvider.createIntent", () => {
  it("creates an order and returns its approve link", async () => {
    mockTokenThen(
      jsonResponse({
        id: "ORDER-1",
        links: [
          { rel: "self", href: "https://api.paypal.com/v2/checkout/orders/ORDER-1" },
          { rel: "approve", href: "https://paypal.com/checkoutnow?token=ORDER-1" },
        ],
      })
    );

    const result = await paypalProvider.createIntent({
      orderNumber: "ORD-1",
      amountMinor: 1999,
      currency: "GBP",
      email: "buyer@example.com",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result).toEqual({ providerRef: "ORDER-1", approveUrl: "https://paypal.com/checkoutnow?token=ORDER-1" });

    const orderCall = fetchMock.mock.calls[1];
    expect(orderCall[0]).toContain("/v2/checkout/orders");
    const body = JSON.parse((orderCall[1] as RequestInit).body as string);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "GBP", value: "19.99" });
  });
});

describe("paypalProvider.capture", () => {
  it("captures an order and maps the completed status", async () => {
    mockTokenThen(
      jsonResponse({
        id: "ORDER-1",
        status: "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                { id: "CAP-1", status: "COMPLETED", amount: { value: "19.99", currency_code: "GBP" }, payment_source_brand: "PAYPAL" },
              ],
            },
          },
        ],
      })
    );

    const result = await paypalProvider.capture("ORDER-1");

    expect(result).toEqual({
      providerRef: "ORDER-1",
      status: "succeeded",
      amountMinor: 1999,
      currency: "GBP",
      paymentMethodBrand: "paypal",
    });
  });

  it("throws when the capture response has no capture entry", async () => {
    mockTokenThen(jsonResponse({ id: "ORDER-1", status: "VOIDED", purchase_units: [{ payments: { captures: [] } }] }));
    await expect(paypalProvider.capture("ORDER-1")).rejects.toThrow(/no capture entry/);
  });
});

describe("paypalProvider.refund", () => {
  it("looks up the capture id from the order before refunding", async () => {
    mockTokenThen(
      jsonResponse({ id: "ORDER-1", purchase_units: [{ payments: { captures: [{ id: "CAP-1" }] } }] }),
      jsonResponse({ id: "REFUND-1", status: "COMPLETED" })
    );

    await paypalProvider.refund("ORDER-1", 500);

    const refundCall = fetchMock.mock.calls[2];
    expect(refundCall[0]).toContain("/v2/payments/captures/CAP-1/refund");
    expect(JSON.parse((refundCall[1] as RequestInit).body as string)).toEqual({
      amount: { value: "5.00", currency_code: "GBP" },
    });
  });

  it("throws when the order has never been captured", async () => {
    mockTokenThen(jsonResponse({ id: "ORDER-1", purchase_units: [{ payments: {} }] }));
    await expect(paypalProvider.refund("ORDER-1")).rejects.toThrow(/No capture found/);
  });
});

describe("paypalProvider.parseWebhookEvent", () => {
  function webhookHeaders() {
    const headers = new Headers();
    headers.set("paypal-transmission-id", "tx-1");
    headers.set("paypal-transmission-time", "2026-01-01T00:00:00Z");
    headers.set("paypal-cert-url", "https://api.paypal.com/cert");
    headers.set("paypal-auth-algo", "SHA256withRSA");
    headers.set("paypal-transmission-sig", "sig");
    return headers;
  }

  it("returns null when verification fails", async () => {
    mockTokenThen(jsonResponse({ verification_status: "FAILURE" }));
    const body = JSON.stringify({ id: "WH-1", event_type: "PAYMENT_CAPTURE_COMPLETED", resource: { id: "CAP-1" } });
    const result = await paypalProvider.parseWebhookEvent(body, webhookHeaders());
    expect(result).toBeNull();
  });

  it("parses a verified PAYMENT_CAPTURE_COMPLETED event", async () => {
    mockTokenThen(jsonResponse({ verification_status: "SUCCESS" }));
    const body = JSON.stringify({ id: "WH-1", event_type: "PAYMENT_CAPTURE_COMPLETED", resource: { id: "CAP-1" } });
    const result = await paypalProvider.parseWebhookEvent(body, webhookHeaders());
    expect(result).toMatchObject({ type: "payment_succeeded", providerRef: "CAP-1", providerEventId: "WH-1" });
  });

  it("parses a verified PAYMENT_CAPTURE_DENIED event", async () => {
    mockTokenThen(jsonResponse({ verification_status: "SUCCESS" }));
    const body = JSON.stringify({ id: "WH-2", event_type: "PAYMENT_CAPTURE_DENIED", resource: { id: "CAP-2" } });
    const result = await paypalProvider.parseWebhookEvent(body, webhookHeaders());
    expect(result).toMatchObject({ type: "payment_failed", providerRef: "CAP-2", providerEventId: "WH-2" });
  });

  it("classifies an unrecognized event type as 'other'", async () => {
    mockTokenThen(jsonResponse({ verification_status: "SUCCESS" }));
    const body = JSON.stringify({ id: "WH-3", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { id: "D-1" } });
    const result = await paypalProvider.parseWebhookEvent(body, webhookHeaders());
    expect(result).toMatchObject({ type: "other", providerEventId: "WH-3" });
  });
});
