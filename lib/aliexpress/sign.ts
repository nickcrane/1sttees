import { createHash } from "node:crypto";

/**
 * AliExpress Open Platform's classic TOP-gateway MD5 signature: the app
 * secret wrapped around both ends of the sorted, concatenated params, then
 * plain MD5'd and hex-encoded uppercase. Not HMAC — confirmed against
 * python-aliexpress-api's `sign()`, the implementation a sibling project
 * runs live. See docs/aliexpress-api-notes.md for the cross-checked vectors
 * this is tested against.
 */
export function signRequest(secret: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.map((key) => `${key}${params[key]}`).join("");
  const wrapped = `${secret}${concatenated}${secret}`;
  return createHash("md5").update(wrapped, "utf8").digest("hex").toUpperCase();
}
