import { describe, expect, it } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";

// Fixture mode -- freight and tracking/detail fixtures mirror shapes
// confirmed against the live docs (freight confirmed live end-to-end too,
// see client-live.test.ts and docs/aliexpress-api-notes.md); order.create
// fixtures cover both documented outcomes without ever calling the real,
// money-moving endpoint from a test.
describe("AliExpressClient (fixture mode) — freight, tracking, order detail, order create", () => {
  it("getFreightQuote returns normalized delivery options from the recorded fixture", async () => {
    const client = new AliExpressClient();
    const options = await client.getFreightQuote({
      productId: "1005006525360508",
      skuId: "12000037527955881",
    });

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      code: "CAINIAO_STANDARD",
      company: "AliExpress standard shipping",
      shippingFeeFormatted: "£3.99",
      shippingFeeCents: 3.99,
      shippingFeeCurrency: "GBP",
      freeShipping: false,
      deliveryDateDesc: "Oct 05 - 20",
      minDeliveryDays: 12,
      maxDeliveryDays: 24,
      shipFromCountry: "CN",
      trackingAvailable: true,
    });
    expect(options[1].freeShipping).toBe(true);
  });

  it("getOrderTracking returns normalized tracking lines with nested events, from a triple-wrapped-list response", async () => {
    const client = new AliExpressClient();
    const lines = await client.getOrderTracking("8198352049851315");

    expect(lines).toHaveLength(1);
    expect(lines[0].mailNo).toBe("4209795192144903600008220012159992");
    expect(lines[0].carrierName).toBe("AliExpress standard shipping");
    expect(lines[0].events).toHaveLength(2);
    expect(lines[0].events[0].name).toBe("Delivery update");
  });

  it("getOrderDetail returns the raw (schema-validated) order detail for a known order", async () => {
    const client = new AliExpressClient();
    const detail = await client.getOrderDetail("8198352049851315");

    expect(detail.order_status).toBe("WAIT_SELLER_SEND_GOODS");
    expect(detail.user_order_amount?.amount).toBe("4.71");
  });

  it("placeOrder reports success and the created order id on the happy-path fixture", async () => {
    const client = new AliExpressClient();
    const result = await client.placeOrder({
      outOrderId: "fixture-out-order-1",
      logisticsAddress: { address: "1 Test St", city: "Cardiff", province: "Wales", country: "GB" },
      items: [{ productId: "1005006525360508", productCount: 1, skuAttr: "14:29#100pcs 54mm" }],
    });

    expect(result.isSuccess).toBe(true);
    expect(result.orderIds).toEqual(["8198352049851315"]);
    expect(result.errorMessage).toBeNull();
  });

  it("placeOrder surfaces is_success:true alongside a payment failure -- created but unpaid, must not be treated as 'will ship'", async () => {
    const client = new AliExpressClient();
    const result = await client.placeOrder({
      outOrderId: "fixture-out-order-paid-fail",
      logisticsAddress: { address: "1 Test St", city: "Cardiff", province: "Wales", country: "GB" },
      items: [{ productId: "1005006525360508", productCount: 1 }],
    });

    // The order WAS created (isSuccess true, a real order id came back) but
    // payment failed -- callers must check errorMessage even on success.
    expect(result.isSuccess).toBe(true);
    expect(result.orderIds).toEqual(["8190439416163295"]);
    expect(result.errorMessage).toBe("OrderCreated, autoPay fail:APIPayFail");
  });
});
