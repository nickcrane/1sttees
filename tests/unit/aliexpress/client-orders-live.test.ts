import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenResponse } from "@/lib/aliexpress/schemas";
import type { TokenSet, TokenStore } from "@/lib/aliexpress/tokens";

function createInMemoryTokenStore(seed: TokenSet | null = null): TokenStore {
  let current = seed;
  return {
    async load() {
      return current;
    },
    async save(response: TokenResponse) {
      current = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? current?.refreshToken ?? "",
        expiresAt: new Date(Date.now() + (response.expires_in ?? 0) * 1000),
        refreshExpiresAt: new Date(Date.now() + (response.refresh_expires_in ?? 0) * 1000),
      };
      return current;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function importLiveClient() {
  vi.resetModules();
  vi.stubEnv("ALIEXPRESS_MODE", "live");
  vi.stubEnv("ALIEXPRESS_APP_KEY", "test-app-key");
  vi.stubEnv("ALIEXPRESS_APP_SECRET", "test-app-secret");
  vi.stubEnv("ALIEXPRESS_GATEWAY_URL", "https://api-sg.aliexpress.com");
  vi.stubEnv("ALIEXPRESS_MIN_REQUEST_INTERVAL_MS", "0");
  vi.stubEnv("ALIEXPRESS_MAX_RETRIES", "0");
  const { AliExpressClient } = await import("@/lib/aliexpress/client");
  return AliExpressClient;
}

describe("AliExpressClient (live mode, fetch mocked) — freight, tracking, order detail, order create", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("getFreightQuote sends queryDeliveryReq as a JSON-string business param", async () => {
    const AliExpressClient = await importLiveClient();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input as string);
      expect(url.searchParams.get("method")).toBe("aliexpress.ds.freight.query");
      const body = new URLSearchParams(init?.body as string);
      const req = JSON.parse(body.get("queryDeliveryReq")!);
      expect(req.productId).toBe("123");
      expect(req.selectedSkuId).toBe("456");
      return jsonResponse({
        aliexpress_ds_freight_query_response: {
          result: { success: true, code: 200, delivery_options: { delivery_option_d_t_o: [{ code: "STD", company: "Std Shipping" }] } },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AliExpressClient(createInMemoryTokenStore());
    const options = await client.getFreightQuote({ productId: 123, skuId: 456 });

    expect(options).toHaveLength(1);
    expect(options[0].code).toBe("STD");
  });

  it("getOrderTracking sends ae_order_id and parses a real-shaped triple-wrapped response", async () => {
    const AliExpressClient = await importLiveClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          aliexpress_ds_order_tracking_get_response: {
            result: {
              ret: true,
              data: {
                tracking_detail_line_list: {
                  tracking_detail: [{ mail_no: "MN1", carrier_name: "Carrier", detail_node_list: { detail_node: [] } }],
                },
              },
            },
          },
        })
      )
    );

    const client = new AliExpressClient(createInMemoryTokenStore());
    const lines = await client.getOrderTracking(12345);
    expect(lines[0].mailNo).toBe("MN1");
  });

  it("getOrderDetail sends single_order_query as a JSON-string business param", async () => {
    const AliExpressClient = await importLiveClient();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      const req = JSON.parse(body.get("single_order_query")!);
      expect(req.order_id).toBe("999");
      return jsonResponse({ aliexpress_trade_ds_order_get_response: { result: { order_status: "FINISH" } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AliExpressClient(createInMemoryTokenStore());
    const detail = await client.getOrderDetail(999);
    expect(detail.order_status).toBe("FINISH");
  });

  it("placeOrder defaults try_to_pay to false when not explicitly requested", async () => {
    const AliExpressClient = await importLiveClient();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      const extend = JSON.parse(body.get("ds_extend_request")!);
      expect(extend.payment.try_to_pay).toBe("false");
      const order = JSON.parse(body.get("param_place_order_request4_open_api_d_t_o")!);
      expect(order.out_order_id).toBe("order-1");
      return jsonResponse({
        aliexpress_ds_order_create_response: { result: { is_success: true, order_list: { number: [111] } } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AliExpressClient(createInMemoryTokenStore());
    const result = await client.placeOrder({
      outOrderId: "order-1",
      logisticsAddress: { address: "1 Test St", city: "Cardiff", province: "Wales", country: "GB" },
      items: [{ productId: 1, productCount: 1 }],
    });

    expect(result.isSuccess).toBe(true);
    expect(result.orderIds).toEqual(["111"]);
  });

  it("placeOrder maps logisticsAddress's camelCase fields to the snake_case the gateway expects", async () => {
    // Regression test: confirmed live 2026-09-18 that passing the camelCase
    // object straight through silently drops every field the gateway
    // doesn't recognize -- a request that DID include mobileNo came back
    // B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL: "Please enter mobile
    // phone number", because the gateway never saw `mobile_no`.
    const AliExpressClient = await importLiveClient();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      const order = JSON.parse(body.get("param_place_order_request4_open_api_d_t_o")!);
      expect(order.logistics_address).toEqual({
        address: "1 Test St",
        city: "Cardiff",
        province: "Wales",
        country: "GB",
        contact_person: "Test Buyer",
        mobile_no: "07700900000",
        phone_country: "+44",
      });
      expect(order.logistics_address.mobileNo).toBeUndefined();
      expect(order.logistics_address.phoneCountry).toBeUndefined();
      return jsonResponse({
        aliexpress_ds_order_create_response: { result: { is_success: true, order_list: { number: [222] } } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AliExpressClient(createInMemoryTokenStore());
    await client.placeOrder({
      outOrderId: "order-2",
      logisticsAddress: {
        address: "1 Test St",
        city: "Cardiff",
        province: "Wales",
        country: "GB",
        contactPerson: "Test Buyer",
        mobileNo: "07700900000",
        phoneCountry: "+44",
      },
      items: [{ productId: 1, productCount: 1 }],
    });
  });

  it("placeOrder surfaces a non-retryable gateway error (e.g. bad address) as an AliExpressApiError, not a crash", async () => {
    const AliExpressClient = await importLiveClient();
    const { AliExpressApiError } = await import("@/lib/aliexpress/errors");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ code: "B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL", msg: "address does not match the rules" })
      )
    );

    const client = new AliExpressClient(createInMemoryTokenStore());
    await expect(
      client.placeOrder({
        outOrderId: "order-bad-addr",
        logisticsAddress: { address: "", city: "", province: "", country: "GB" },
        items: [{ productId: 1, productCount: 1 }],
      })
    ).rejects.toBeInstanceOf(AliExpressApiError);
  });
});
