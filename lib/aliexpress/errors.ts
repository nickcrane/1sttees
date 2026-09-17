/**
 * Typed AliExpress error union. `retryable` distinguishes transient gateway/
 * network failures (worth an exponential-backoff retry) from terminal
 * business errors (a bad product id, an unpaid order, an expired token --
 * retrying identically will never help).
 */
export type AliExpressError =
  | { kind: "network"; retryable: true; message: string; cause: unknown }
  | { kind: "http_status"; retryable: boolean; status: number; message: string }
  | { kind: "gateway"; retryable: boolean; errorCode: string; message: string }
  | { kind: "schema_drift"; retryable: false; method: string; message: string; raw: unknown }
  | { kind: "token_missing"; retryable: false; message: string }
  | { kind: "token_expired"; retryable: false; message: string };

export class AliExpressApiError extends Error {
  readonly detail: AliExpressError;

  constructor(detail: AliExpressError) {
    super(detail.message);
    this.name = "AliExpressApiError";
    this.detail = detail;
  }
}

// Gateway error codes documented (or observed) as transient -- worth a
// backoff retry rather than surfacing immediately. Everything else defaults
// to non-retryable so an unrecognized error fails fast instead of looping.
const RETRYABLE_GATEWAY_CODES = new Set([
  "ERROR_WHEN_BUILD_FOR_PLACE_ORDER", // "System error, please connect tech support" (docs)
  "INVENTORY_HOLD_ERROR", // may be a transient lock, not necessarily out of stock
]);

export function isRetryableGatewayCode(code: string): boolean {
  return RETRYABLE_GATEWAY_CODES.has(code);
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}
