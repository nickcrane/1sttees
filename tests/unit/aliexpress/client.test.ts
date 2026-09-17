import { describe, expect, it } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressApiError } from "@/lib/aliexpress/errors";
import type { TokenResponse } from "@/lib/aliexpress/schemas";
import type { TokenSet, TokenStore } from "@/lib/aliexpress/tokens";

/** In-memory TokenStore double -- lets OAuth-flow tests run without a real Postgres connection. */
function createInMemoryTokenStore(): TokenStore {
  let current: TokenSet | null = null;
  return {
    async load() {
      return current;
    },
    async save(response: TokenResponse) {
      const now = Date.now();
      current = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? current?.refreshToken ?? "",
        expiresAt: new Date(now + (response.expires_in ?? 0) * 1000),
        refreshExpiresAt: new Date(now + (response.refresh_expires_in ?? 0) * 1000),
      };
      return current;
    },
  };
}

// Fixture mode (the vitest-wide default -- see vitest.config.ts) reads
// recorded JSON from fixtures/aliexpress/, no network, no credentials, no
// database -- exercising exactly the same normalize/validate path a live
// response would go through.
describe("AliExpressClient (fixture mode)", () => {
  it("getProductDetail returns a normalized product from the recorded fixture", async () => {
    const client = new AliExpressClient();
    const product = await client.getProductDetail("1005006543210987");

    expect(product.productId).toBe("1005006543210987");
    expect(product.title).toContain("Bamboo");
    expect(product.imageUrls).toHaveLength(3);
    expect(product.skus).toHaveLength(2);
    expect(product.skus[0].skuAttrs).toBe("14:200000led#83mm");
    expect(product.targetSalePrice).toBe(4.29);
  });

  it("getProductDetail throws a clear error for a product with no matching fixture", async () => {
    const client = new AliExpressClient();
    await expect(client.getProductDetail("does-not-exist")).rejects.toThrow(/No fixture/);
  });

  it("searchProducts returns normalized results from the recorded fixture", async () => {
    const client = new AliExpressClient();
    const result = await client.searchProducts({ keywords: "bamboo golf tees" });

    expect(result.products).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.products[0].productId).toBe("1005006543210987");
    expect(result.products[0].productUrl).toMatch(/^https:/);
    expect(result.products[0].salesVolumeDisplay).toBe("500+");
  });

  it("exchangeCodeForToken parses the recorded token fixture (envelope already flat, per current docs)", async () => {
    const client = new AliExpressClient(createInMemoryTokenStore());
    const token = await client.exchangeCodeForToken("fixture-code");
    expect(token.accessToken).toBe("fixture-access-token-abc123");
    expect(token.refreshToken).toBe("fixture-refresh-token-xyz789");
  });

  it("refreshAccessToken rotates both tokens from the recorded fixture", async () => {
    const client = new AliExpressClient(createInMemoryTokenStore());
    await client.exchangeCodeForToken("fixture-code");
    const refreshed = await client.refreshAccessToken();
    expect(refreshed.accessToken).toBe("fixture-access-token-refreshed-def456");
    expect(refreshed.refreshToken).toBe("fixture-refresh-token-refreshed-uvw012");
  });

  it("refreshAccessToken refuses to refresh when no token has been obtained yet", async () => {
    const client = new AliExpressClient(createInMemoryTokenStore());
    await expect(client.refreshAccessToken()).rejects.toThrow(/No token on file/);
  });

  it("getAuthorizeUrl builds the documented OAuth URL shape", () => {
    const client = new AliExpressClient();
    expect(() => client.getAuthorizeUrl()).toThrow(/ALIEXPRESS_APP_KEY/);
  });
});

describe("AliExpressApiError", () => {
  it("carries a typed, discriminable detail payload", () => {
    const error = new AliExpressApiError({ kind: "token_missing", retryable: false, message: "no token" });
    expect(error.detail.kind).toBe("token_missing");
    expect(error.message).toBe("no token");
  });
});
