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

/** live-mode client tests need env re-imported with ALIEXPRESS_MODE=live, so
 * every test goes through this rather than a static top-level import. */
async function importLiveClient() {
  vi.resetModules();
  vi.stubEnv("ALIEXPRESS_MODE", "live");
  vi.stubEnv("ALIEXPRESS_APP_KEY", "test-app-key");
  vi.stubEnv("ALIEXPRESS_APP_SECRET", "test-app-secret");
  vi.stubEnv("ALIEXPRESS_GATEWAY_URL", "https://api-sg.aliexpress.com");
  vi.stubEnv("ALIEXPRESS_CALLBACK_URL", "https://example.com/callback");
  vi.stubEnv("ALIEXPRESS_MIN_REQUEST_INTERVAL_MS", "0");
  vi.stubEnv("ALIEXPRESS_MAX_RETRIES", "2");
  vi.stubEnv("ALIEXPRESS_BACKOFF_BASE_MS", "1");
  vi.stubEnv("ALIEXPRESS_BACKOFF_MAX_MS", "5");
  const { AliExpressClient } = await import("@/lib/aliexpress/client");
  return AliExpressClient;
}

describe("AliExpressClient (live mode, fetch mocked)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("getAuthorizeUrl builds the documented OAuth URL", async () => {
    const AliExpressClient = await importLiveClient();
    const client = new AliExpressClient();
    const url = new URL(client.getAuthorizeUrl());
    expect(url.origin + url.pathname).toBe("https://api-sg.aliexpress.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-app-key");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
  });

  it("signs and sends a business-interface call to /sync with method as a query param", async () => {
    const AliExpressClient = await importLiveClient();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input as string);
      expect(url.pathname).toBe("/sync");
      expect(url.searchParams.get("method")).toBe("aliexpress.ds.product.get");
      expect(url.searchParams.get("app_key")).toBe("test-app-key");
      expect(url.searchParams.get("sign")).toBeTruthy();
      return jsonResponse({
        result: {
          ae_item_base_info_dto: { product_id: 123, subject: "Test Product" },
        },
        rsp_code: "200",
        rsp_msg: "success",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AliExpressClient(createInMemoryTokenStore());
    const product = await client.getProductDetail(123);

    expect(product.title).toBe("Test Product");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes session (the access token) once one has been obtained", async () => {
    const AliExpressClient = await importLiveClient();
    let capturedSession: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        capturedSession = new URL(input as string).searchParams.get("session");
        return jsonResponse({ result: { ae_item_base_info_dto: { product_id: 1, subject: "x" } }, rsp_code: "200" });
      })
    );

    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const store = createInMemoryTokenStore({
      accessToken: "live-token-abc",
      refreshToken: "refresh-abc",
      expiresAt: futureExpiry,
      refreshExpiresAt: futureExpiry,
    });
    const AliExpressClientCtor = AliExpressClient;
    const client = new AliExpressClientCtor(store);
    await client.getProductDetail(1);

    expect(capturedSession).toBe("live-token-abc");
  });

  it("retries a retryable HTTP 503, then succeeds", async () => {
    const AliExpressClient = await importLiveClient();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 2) return new Response("gateway unavailable", { status: 503 });
        return jsonResponse({ result: { ae_item_base_info_dto: { product_id: 1, subject: "recovered" } }, rsp_code: "200" });
      })
    );

    const client = new AliExpressClient(createInMemoryTokenStore());
    const product = await client.getProductDetail(1);

    expect(product.title).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("does not retry a non-retryable gateway error, and surfaces it as an AliExpressApiError", async () => {
    const AliExpressClient = await importLiveClient();
    const { AliExpressApiError } = await import("@/lib/aliexpress/errors");
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return jsonResponse({ code: "15", msg: "product not found" });
      })
    );

    const client = new AliExpressClient(createInMemoryTokenStore());
    await expect(client.searchProducts({ keywords: "anything" })).rejects.toBeInstanceOf(AliExpressApiError);
    expect(calls).toBe(1); // no retry -- confirms the search path is behind withRetries too, but stops immediately on a non-retryable code
  });

  it("gives up after exhausting retries on a persistently retryable failure", async () => {
    const AliExpressClient = await importLiveClient();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("still down", { status: 503 });
      })
    );

    const client = new AliExpressClient(createInMemoryTokenStore());
    await expect(client.getProductDetail(1)).rejects.toThrow();
    // ALIEXPRESS_MAX_RETRIES=2 -- one initial attempt plus two retries = 3 calls
    expect(calls).toBe(3);
  });

  it("signs and sends a system-interface call (token exchange) to /rest{path}", async () => {
    const AliExpressClient = await importLiveClient();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input as string);
      expect(url.pathname).toBe("/rest/auth/token/create");
      expect(url.searchParams.get("sign")).toBeTruthy();
      return jsonResponse({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 86400, refresh_expires_in: 172800 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AliExpressClient(createInMemoryTokenStore());
    const token = await client.exchangeCodeForToken("some-code");

    expect(token.accessToken).toBe("new-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
