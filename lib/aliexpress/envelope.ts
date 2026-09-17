/**
 * The response envelope is genuinely inconsistent across the aliexpress.ds.*
 * family -- confirmed live by the sibling aliexpress-dashboard project, not
 * assumed from docs:
 *   - aliexpress.ds.product.get: unwrapped, `{result, rsp_code, rsp_msg}` directly.
 *   - aliexpress.ds.text.search, /auth/token/*: one level, `{"<method>_response": {...}}`.
 *   - aliexpress.ds.category.get: two levels -- the same wrapper, then a
 *     `resp_result` key alongside sibling metadata (request_id, ...).
 * Auto-detect rather than hardcode per method -- more resilient, and this
 * hasn't been exhaustively checked against every method this client calls.
 */
export function unwrapEnvelope(body: unknown): Record<string, unknown> {
  let envelope = body;
  if (isPlainObject(envelope) && Object.keys(envelope).length === 1) {
    const [[key, value]] = Object.entries(envelope);
    if (key.endsWith("_response") && isPlainObject(value)) {
      envelope = value;
    }
  }
  if (isPlainObject(envelope) && isPlainObject(envelope.resp_result)) {
    envelope = envelope.resp_result;
  }
  if (!isPlainObject(envelope)) {
    throw new Error(`Expected an object response envelope, got: ${typeof envelope}`);
  }
  return envelope;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Different endpoints signal success under different field names --
 * confirmed live: text.search uses `code` ("00" for success), product.get
 * uses `rsp_code` ("200"), category.get uses `resp_code` (200, an int).
 * A response with none of these fields present is treated as successful
 * (matches the confirmed-live client's own behaviour) rather than guessed at.
 */
const CODE_FIELDS: Array<[code: string, message: string]> = [
  ["code", "msg"],
  ["rsp_code", "rsp_msg"],
  ["resp_code", "resp_msg"],
];

export function checkEnvelopeSuccess(envelope: Record<string, unknown>): { success: true } | { success: false; errorCode: string; message: string } {
  for (const [codeField, messageField] of CODE_FIELDS) {
    if (!(codeField in envelope)) continue;
    const code = envelope[codeField];
    const success = codeField === "code" ? isAllZeros(code) : String(code) === "200" || isAllZeros(code);
    if (!success) {
      const message = String(envelope[messageField] ?? "unknown error");
      // sub_code/sub_msg (seen on the `error_response` envelope shape, e.g.
      // "isv.insufficient-permission") are far more diagnostic than the
      // generic top-level message alone -- confirmed live querying
      // aliexpress.trade.ds.order.get for an order this account doesn't
      // own: top-level msg was just "Remote service error". Append rather
      // than replace, since either field alone can be uninformative.
      const subCode = envelope.sub_code;
      const subMsg = envelope.sub_msg;
      const detail = subCode || subMsg ? ` [${[subCode, subMsg].filter(Boolean).join(": ")}]` : "";
      return { success: false, errorCode: String(code), message: `${message}${detail}` };
    }
  }
  return { success: true };
}

function isAllZeros(code: unknown): boolean {
  if (code === null || code === undefined) return true;
  if (typeof code === "number") return code === 0;
  if (typeof code === "string") {
    const trimmed = code.trim();
    return trimmed === "" || [...trimmed].every((c) => c === "0");
  }
  return false;
}
