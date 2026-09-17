import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { signRequest } from "./sign";
import { checkEnvelopeSuccess, unwrapEnvelope } from "./envelope";
import { AliExpressApiError, isRetryableGatewayCode, isRetryableHttpStatus } from "./errors";
import {
  normalizeProductDetail,
  normalizeSearchProduct,
  rawProductDetailResultSchema,
  searchResponseDataSchema,
  tokenResponseSchema,
  type NormalizedProduct,
  type NormalizedSearchProduct,
} from "./schemas";
import { prismaTokenStore } from "./prismaTokenStore";
import type { TokenSet, TokenStore } from "./tokens";

const SDK_PARTNER_ID = "1stees-node";

export interface SearchParams {
  keywords: string;
  pageNo?: number;
  pageSize?: number;
  sort?: string;
  categoryId?: string;
  shipToCountry?: string;
}

export interface SearchResult {
  products: NormalizedSearchProduct[];
  pageNo: number;
  totalCount: number;
}

export class AliExpressClient {
  private lastRequestAt = 0;
  private readonly tokenStore: TokenStore;

  constructor(tokenStore: TokenStore = prismaTokenStore) {
    this.tokenStore = tokenStore;
  }

  getAuthorizeUrl(): string {
    if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_CALLBACK_URL) {
      throw new Error("ALIEXPRESS_APP_KEY and ALIEXPRESS_CALLBACK_URL must be set to build an authorize URL");
    }
    const url = new URL("/oauth/authorize", env.ALIEXPRESS_GATEWAY_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("force_auth", "true");
    url.searchParams.set("redirect_uri", env.ALIEXPRESS_CALLBACK_URL);
    url.searchParams.set("client_id", env.ALIEXPRESS_APP_KEY);
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<TokenSet> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["auth", "token_create.json"])
        : await this.callSystemInterface("/auth/token/create", { code });
    const parsed = tokenResponseSchema.parse(envelope);
    return this.tokenStore.save(parsed);
  }

  async refreshAccessToken(): Promise<TokenSet> {
    const current = await this.tokenStore.load();
    if (!current) {
      throw new AliExpressApiError({ kind: "token_missing", retryable: false, message: "No token on file -- run the authorize flow first." });
    }
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["auth", "token_refresh.json"])
        : await this.callSystemInterface("/auth/token/refresh", { refresh_token: current.refreshToken });
    const parsed = tokenResponseSchema.parse(envelope);
    return this.tokenStore.save(parsed);
  }

  async getProductDetail(productId: string | number): Promise<NormalizedProduct> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["product_detail", `${productId}.json`])
        : await this.withRetries(() =>
            this.callBusinessInterface("aliexpress.ds.product.get", {
              product_id: String(productId),
              ship_to_country: env.ALIEXPRESS_SHIP_TO_COUNTRY,
              target_currency: env.ALIEXPRESS_TARGET_CURRENCY,
              target_language: env.ALIEXPRESS_TARGET_LANGUAGE,
            })
          );

    const result = (envelope as { result?: unknown }).result;
    const parsedResult = rawProductDetailResultSchema.safeParse(result);
    if (!parsedResult.success) {
      logger.warn({ productId, issues: parsedResult.error.issues }, "aliexpress.ds.product.get: response shape drifted from what this client expects");
      throw new AliExpressApiError({
        kind: "schema_drift",
        retryable: false,
        method: "aliexpress.ds.product.get",
        message: `Response for product ${productId} didn't match the expected shape`,
        raw: result,
      });
    }
    return normalizeProductDetail(parsedResult.data, env.ALIEXPRESS_TARGET_CURRENCY);
  }

  async searchProducts(params: SearchParams): Promise<SearchResult> {
    const pageNo = params.pageNo ?? 1;
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["text_search", `${fixtureNameFor(params)}.json`])
        : await this.withRetries(() =>
            this.callBusinessInterface("aliexpress.ds.text.search", {
              keyWord: params.keywords,
              local: env.ALIEXPRESS_TARGET_LANGUAGE,
              countryCode: params.shipToCountry ?? env.ALIEXPRESS_SHIP_TO_COUNTRY,
              categoryId: params.categoryId,
              sortBy: params.sort,
              pageSize: String(params.pageSize ?? 20),
              pageIndex: String(pageNo),
              currency: env.ALIEXPRESS_TARGET_CURRENCY,
            })
          );

    const data = (envelope as { data?: unknown }).data;
    const parsedData = searchResponseDataSchema.safeParse(data);
    if (!parsedData.success) {
      logger.warn({ params, issues: parsedData.error.issues }, "aliexpress.ds.text.search: response shape drifted from what this client expects");
      throw new AliExpressApiError({
        kind: "schema_drift",
        retryable: false,
        method: "aliexpress.ds.text.search",
        message: "Search response didn't match the expected shape",
        raw: data,
      });
    }
    const productsRaw = parsedData.data.products;
    const products = productsRaw === undefined ? [] : Array.isArray(productsRaw) ? productsRaw : [productsRaw];

    return {
      products: products.map((p) => normalizeSearchProduct(p, env.ALIEXPRESS_TARGET_CURRENCY)),
      pageNo: Number(parsedData.data.pageIndex ?? pageNo),
      totalCount: Number(parsedData.data.totalCount ?? products.length),
    };
  }

  // -- fixture loading --------------------------------------------------

  private async loadFixture(pathParts: string[]): Promise<Record<string, unknown>> {
    const filePath = path.join(env.ALIEXPRESS_FIXTURES_DIR, ...pathParts);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      throw new Error(`No fixture at ${filePath}`);
    }
    return unwrapEnvelope(JSON.parse(raw));
  }

  // -- live request construction -----------------------------------------

  private async callSystemInterface(apiPath: string, businessParams: Record<string, string>): Promise<Record<string, unknown>> {
    const systemParams = this.buildSystemParams();
    const allParams = { ...systemParams, ...businessParams };
    const sign = signRequest(this.requireAppSecret(), allParams);

    const url = new URL(env.ALIEXPRESS_GATEWAY_URL);
    url.pathname = `/rest${apiPath}`;
    for (const [key, value] of Object.entries(systemParams)) url.searchParams.set(key, value);
    url.searchParams.set("sign", sign);

    return this.post(url, businessParams);
  }

  private async callBusinessInterface(method: string, businessParams: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const cleanParams = Object.fromEntries(
      Object.entries(businessParams).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
    const token = await this.getValidAccessToken();
    const systemParams: Record<string, string> = { ...this.buildSystemParams(), method };
    if (token) systemParams.session = token;
    const allParams = { ...systemParams, ...cleanParams };
    const sign = signRequest(this.requireAppSecret(), allParams);

    const url = new URL("/sync", env.ALIEXPRESS_GATEWAY_URL);
    for (const [key, value] of Object.entries(systemParams)) url.searchParams.set(key, value);
    url.searchParams.set("sign", sign);

    return this.post(url, cleanParams);
  }

  private buildSystemParams(): Record<string, string> {
    if (!env.ALIEXPRESS_APP_KEY) {
      throw new Error("ALIEXPRESS_APP_KEY must be set for a live AliExpress call");
    }
    return {
      app_key: env.ALIEXPRESS_APP_KEY,
      timestamp: String(Date.now()),
      format: "json",
      v: "2.0",
      sign_method: "md5",
      partner_id: SDK_PARTNER_ID,
    };
  }

  private requireAppSecret(): string {
    if (!env.ALIEXPRESS_APP_SECRET) {
      throw new Error("ALIEXPRESS_APP_SECRET must be set for a live AliExpress call");
    }
    return env.ALIEXPRESS_APP_SECRET;
  }

  private async getValidAccessToken(): Promise<string | null> {
    const token = await this.tokenStore.load();
    if (!token) return null;
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;
    if (token.expiresAt.getTime() - Date.now() < THIRTY_MINUTES_MS) {
      const refreshed = await this.refreshAccessToken();
      return refreshed.accessToken;
    }
    return token.accessToken;
  }

  private async post(url: URL, formBody: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(formBody),
      });
    } catch (cause) {
      throw new AliExpressApiError({ kind: "network", retryable: true, message: "Network error calling AliExpress", cause });
    }

    if (!response.ok) {
      throw new AliExpressApiError({
        kind: "http_status",
        retryable: isRetryableHttpStatus(response.status),
        status: response.status,
        message: `AliExpress gateway returned HTTP ${response.status}`,
      });
    }

    const body = await response.json();
    const envelope = unwrapEnvelope(body);
    const check = checkEnvelopeSuccess(envelope);
    if (!check.success) {
      throw new AliExpressApiError({
        kind: "gateway",
        retryable: isRetryableGatewayCode(check.errorCode),
        errorCode: check.errorCode,
        message: check.message,
      });
    }
    return envelope;
  }

  // -- throttling and retry ----------------------------------------------

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const minInterval = env.ALIEXPRESS_MIN_REQUEST_INTERVAL_MS;
    if (elapsed < minInterval) {
      await sleep(minInterval - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async withRetries<T>(call: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      await this.throttle();
      try {
        return await call();
      } catch (error) {
        attempt += 1;
        const retryable = error instanceof AliExpressApiError && error.detail.retryable;
        if (!retryable || attempt > env.ALIEXPRESS_MAX_RETRIES) throw error;
        const delay = Math.min(env.ALIEXPRESS_BACKOFF_BASE_MS * 2 ** (attempt - 1), env.ALIEXPRESS_BACKOFF_MAX_MS);
        const jitter = Math.random() * delay * 0.1;
        logger.warn({ attempt, delay, error }, "AliExpress API call failed, retrying");
        await sleep(delay + jitter);
      }
    }
  }
}

function fixtureNameFor(params: SearchParams): string {
  const base = params.keywords.trim().toLowerCase().replace(/\s+/g, "-");
  return params.pageNo && params.pageNo > 1 ? `${base}_page${params.pageNo}` : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
