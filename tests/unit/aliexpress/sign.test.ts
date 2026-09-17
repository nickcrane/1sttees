import { describe, expect, it } from "vitest";
import { signRequest } from "@/lib/aliexpress/sign";

// Vectors computed by running python-aliexpress-api's own sign() function
// (the implementation a sibling project runs live against this gateway) --
// see docs/aliexpress-api-notes.md's "Signing algorithm" section for how.
describe("signRequest", () => {
  it("matches the cross-checked vector for a simple param set", () => {
    const result = signRequest("testsecret", {
      foo: "1",
      bar: "2",
      foo_bar: "3",
      foobar: "4",
    });
    expect(result).toBe("54C22189FE38F1B7E6E4D701FB82851E");
  });

  it("matches the cross-checked vector for a realistic product.get-shaped request", () => {
    const result = signRequest("my_app_secret_123", {
      app_key: "12345678",
      method: "aliexpress.ds.product.get",
      timestamp: "1700000000000",
      format: "json",
      v: "2.0",
      sign_method: "md5",
      partner_id: "taobao-sdk-python-20200924",
      session: "test-access-token",
      product_id: "1005001234567890",
      ship_to_country: "GB",
      target_currency: "GBP",
      target_language: "en_US",
    });
    expect(result).toBe("3C285A05E7275C1E100E170EFA715F1E");
  });

  it("is order-independent -- param insertion order must not affect the signature", () => {
    const a = signRequest("s3cr3t", { z: "1", a: "2", m: "3" });
    const b = signRequest("s3cr3t", { m: "3", z: "1", a: "2" });
    expect(a).toBe(b);
  });

  it("changes when the secret changes", () => {
    const a = signRequest("secret-one", { foo: "1" });
    const b = signRequest("secret-two", { foo: "1" });
    expect(a).not.toBe(b);
  });
});
