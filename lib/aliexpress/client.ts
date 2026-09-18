import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { signRequest } from "./sign";
import { checkEnvelopeSuccess, unwrapEnvelope } from "./envelope";
import { AliExpressApiError, isRetryableGatewayCode, isRetryableHttpStatus } from "./errors";
import {
  extractValidItems,
  normalizeFreightOptions,
  normalizeProductDetail,
  normalizeSearchProduct,
  normalizeTrackingLines,
  rawFreightResultSchema,
  rawOrderDetailResultSchema,
  rawProductDetailResultSchema,
  rawSearchProductSchema,
  rawTrackingResultSchema,
  searchResponseDataSchema,
  tokenResponseSchema,
  type NormalizedFreightOption,
  type NormalizedProduct,
  type NormalizedSearchProduct,
  type NormalizedTrackingLine,
  type RawOrderDetailResult,
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

export interface FreightQuoteParams {
  productId: string | number;
  skuId: string | number;
  quantity?: number;
  shipToCountry?: string;
  provinceCode?: string;
  cityCode?: string;
  currency?: string;
}

export interface PlaceOrderParams {
  outOrderId: string; // your own idempotency key -- see docs/aliexpress-api-notes.md, 24h validity window
  logisticsAddress: {
    address: string;
    city: string;
    province: string;
    country: string; // ISO-2
    contactPerson?: string;
    fullName?: string;
    zip?: string;
    mobileNo?: string;
    phoneCountry?: string;
  };
  items: Array<{
    productId: string | number;
    productCount: number;
    skuAttr?: string; // verbatim from getProductDetail's skus[].skuAttrs
    logisticsServiceName?: string; // verbatim from getFreightQuote's options[].code
  }>;
  /**
   * Defaults to false deliberately -- true attempts real payment via
   * AliExpress's auto-pay, which requires a manual whitelist application
   * (see docs/aliexpress-api-notes.md "Automatic payment") and moves real
   * money. Never set this without the whitelist in place and explicit
   * confirmation that placing a real, paid order is intended.
   */
  tryToPay?: boolean;
  payCurrency?: string;
}

export interface PlaceOrderResult {
  isSuccess: boolean;
  orderIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
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
        : await this.withRetries(() => this.callApi("/auth/token/create", { code }, { attachToken: false }));
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
        : await this.withRetries(() =>
            this.callApi("/auth/token/refresh", { refresh_token: current.refreshToken }, { attachToken: false })
          );
    const parsed = tokenResponseSchema.parse(envelope);
    return this.tokenStore.save(parsed);
  }

  async getProductDetail(productId: string | number): Promise<NormalizedProduct> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["product_detail", `${productId}.json`])
        : await this.withRetries(() =>
            this.callApi(
              "aliexpress.ds.product.get",
              {
                product_id: String(productId),
                ship_to_country: env.ALIEXPRESS_SHIP_TO_COUNTRY,
                target_currency: env.ALIEXPRESS_TARGET_CURRENCY,
                target_language: env.ALIEXPRESS_TARGET_LANGUAGE,
              },
              { attachToken: true }
            )
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
            this.callApi(
              "aliexpress.ds.text.search",
              {
                keyWord: params.keywords,
                local: env.ALIEXPRESS_TARGET_LANGUAGE,
                countryCode: params.shipToCountry ?? env.ALIEXPRESS_SHIP_TO_COUNTRY,
                categoryId: params.categoryId,
                sortBy: params.sort,
                pageSize: String(params.pageSize ?? 20),
                pageIndex: String(pageNo),
                currency: env.ALIEXPRESS_TARGET_CURRENCY,
              },
              { attachToken: true }
            )
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
    const products = extractValidItems(parsedData.data.products, rawSearchProductSchema, {
      method: "aliexpress.ds.text.search",
      field: "products",
    });

    return {
      products: products.map((p) => normalizeSearchProduct(p, env.ALIEXPRESS_TARGET_CURRENCY)),
      pageNo: Number(parsedData.data.pageIndex ?? pageNo),
      totalCount: Number(parsedData.data.totalCount ?? products.length),
    };
  }

  /** Read-only -- quotes shipping options/cost, no order or side effect of any kind. Confirmed live 2026-09-17. */
  async getFreightQuote(params: FreightQuoteParams): Promise<NormalizedFreightOption[]> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["freight_query", `${params.productId}_${params.skuId}.json`])
        : await this.withRetries(() =>
            this.callApi(
              "aliexpress.ds.freight.query",
              {
                queryDeliveryReq: JSON.stringify({
                  productId: String(params.productId),
                  selectedSkuId: String(params.skuId),
                  quantity: String(params.quantity ?? 1),
                  shipToCountry: params.shipToCountry ?? env.ALIEXPRESS_SHIP_TO_COUNTRY,
                  provinceCode: params.provinceCode,
                  cityCode: params.cityCode,
                  currency: params.currency ?? env.ALIEXPRESS_TARGET_CURRENCY,
                  language: env.ALIEXPRESS_TARGET_LANGUAGE,
                  locale: env.ALIEXPRESS_TARGET_LANGUAGE,
                }),
              },
              { attachToken: true }
            )
          );

    const result = (envelope as { result?: unknown }).result;
    const parsedResult = rawFreightResultSchema.safeParse(result);
    if (!parsedResult.success) {
      logger.warn({ params, issues: parsedResult.error.issues }, "aliexpress.ds.freight.query: response shape drifted from what this client expects");
      throw new AliExpressApiError({
        kind: "schema_drift",
        retryable: false,
        method: "aliexpress.ds.freight.query",
        message: "Freight response didn't match the expected shape",
        raw: result,
      });
    }
    return normalizeFreightOptions(parsedResult.data, "aliexpress.ds.freight.query");
  }

  /** Read-only -- looks up tracking for an existing AliExpress order. Not yet exercised live (needs a real order id). */
  async getOrderTracking(aeOrderId: string | number): Promise<NormalizedTrackingLine[]> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["order_tracking", `${aeOrderId}.json`])
        : await this.withRetries(() =>
            this.callApi(
              "aliexpress.ds.order.tracking.get",
              { ae_order_id: String(aeOrderId), language: env.ALIEXPRESS_TARGET_LANGUAGE },
              { attachToken: true }
            )
          );

    const result = (envelope as { result?: unknown }).result;
    const parsedResult = rawTrackingResultSchema.safeParse(result);
    if (!parsedResult.success) {
      logger.warn({ aeOrderId, issues: parsedResult.error.issues }, "aliexpress.ds.order.tracking.get: response shape drifted from what this client expects");
      throw new AliExpressApiError({
        kind: "schema_drift",
        retryable: false,
        method: "aliexpress.ds.order.tracking.get",
        message: `Tracking response for order ${aeOrderId} didn't match the expected shape`,
        raw: result,
      });
    }
    return normalizeTrackingLines(parsedResult.data, "aliexpress.ds.order.tracking.get");
  }

  /** Read-only -- looks up order status/amounts for an existing AliExpress order. Not yet exercised live (needs a real order id). */
  async getOrderDetail(orderId: string | number): Promise<RawOrderDetailResult> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["order_detail", `${orderId}.json`])
        : await this.withRetries(() =>
            this.callApi(
              "aliexpress.trade.ds.order.get",
              { single_order_query: JSON.stringify({ order_id: String(orderId) }) },
              { attachToken: true }
            )
          );

    const result = (envelope as { result?: unknown }).result;
    const parsedResult = rawOrderDetailResultSchema.safeParse(result);
    if (!parsedResult.success) {
      logger.warn({ orderId, issues: parsedResult.error.issues }, "aliexpress.trade.ds.order.get: response shape drifted from what this client expects");
      throw new AliExpressApiError({
        kind: "schema_drift",
        retryable: false,
        method: "aliexpress.trade.ds.order.get",
        message: `Order detail response for ${orderId} didn't match the expected shape`,
        raw: result,
      });
    }
    return parsedResult.data;
  }

  /**
   * Places a real AliExpress order. **Not idempotent-safe to call blindly on
   * retry without `outOrderId`** -- always set it (see PlaceOrderParams).
   * With `tryToPay: true` (requires the auto-pay whitelist, see
   * docs/aliexpress-api-notes.md), this moves real money and creates a real
   * obligation to a real seller; with it omitted/false, an order still gets
   * created on the seller's side, sitting unpaid -- there is no API to
   * cancel it, only the AliExpress website. Never call this without being
   * certain that's the intended, confirmed action.
   */
  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const envelope =
      env.ALIEXPRESS_MODE === "fixture"
        ? await this.loadFixture(["order_create", `${params.outOrderId}.json`])
        : await this.withRetries(() =>
            this.callApi(
              "aliexpress.ds.order.create",
              {
                ds_extend_request: JSON.stringify({
                  payment: { pay_currency: params.payCurrency ?? "USD", try_to_pay: String(params.tryToPay ?? false) },
                }),
                param_place_order_request4_open_api_d_t_o: JSON.stringify({
                  out_order_id: params.outOrderId,
                  logistics_address: mapLogisticsAddress(params.logisticsAddress),
                  product_items: params.items.map((item) => ({
                    product_id: item.productId,
                    product_count: item.productCount,
                    sku_attr: item.skuAttr ?? "",
                    logistics_service_name: item.logisticsServiceName ?? "",
                  })),
                }),
              },
              { attachToken: true }
            )
          );

    const result = (envelope as { result?: { is_success?: boolean; order_list?: { number?: Array<string | number> }; error_code?: string; error_msg?: string } }).result;
    const orderIds = (result?.order_list?.number ?? []).map((n) => String(n));
    return {
      isSuccess: result?.is_success ?? false,
      orderIds,
      errorCode: result?.error_code ?? null,
      errorMessage: result?.error_msg ?? null,
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

  /**
   * Every call -- whether the docs call it a "Business interface" (a dotted
   * `aliexpress.*` name) or a "System interface" (a path like
   * `/auth/token/create`) -- goes to the same `/sync` endpoint with `method`
   * as a normal signed param. The docs describe a second URL shape
   * (`/rest{path}` for system interfaces, no `method` param, the path
   * prepended into the signed string instead) that turned out not to be
   * what this gateway actually accepts: confirmed by a live 401
   * "IncompleteSignature" using that shape, then success once rebuilt to
   * match python-aliexpress-api's proven, live-working request construction
   * exactly. See docs/aliexpress-api-notes.md.
   */
  private async callApi(
    method: string,
    businessParams: Record<string, string | undefined>,
    options: { attachToken: boolean }
  ): Promise<Record<string, unknown>> {
    const cleanParams = Object.fromEntries(
      Object.entries(businessParams).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
    const systemParams: Record<string, string> = { ...this.buildSystemParams(), method };
    if (options.attachToken) {
      const token = await this.getValidAccessToken();
      if (token) systemParams.session = token;
    }
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

/**
 * Maps PlaceOrderParams.logisticsAddress's camelCase fields to the
 * snake_case shape aliexpress.ds.order.create actually expects
 * (`mobile_no`, `phone_country`, etc.) -- confirmed live 2026-09-18 that
 * passing the camelCase object straight through, unmapped, silently drops
 * every field the gateway doesn't recognize: a request that *did* include
 * a mobile number came back `B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL:
 * "Please enter mobile phone number"`, because the gateway never saw
 * `mobileNo` as `mobile_no`.
 */
function mapLogisticsAddress(address: PlaceOrderParams["logisticsAddress"]): Record<string, string> {
  const mapped: Record<string, string | undefined> = {
    address: address.address,
    city: address.city,
    province: address.province,
    country: address.country,
    contact_person: address.contactPerson,
    full_name: address.fullName,
    zip: address.zip,
    mobile_no: address.mobileNo,
    phone_country: address.phoneCountry,
  };
  return Object.fromEntries(Object.entries(mapped).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function fixtureNameFor(params: SearchParams): string {
  const base = params.keywords.trim().toLowerCase().replace(/\s+/g, "-");
  return params.pageNo && params.pageNo > 1 ? `${base}_page${params.pageNo}` : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
