import { describe, expect, it } from "vitest";
import { checkEnvelopeSuccess, unwrapEnvelope } from "@/lib/aliexpress/envelope";

describe("unwrapEnvelope", () => {
  it("leaves an already-flat envelope alone (aliexpress.ds.product.get shape)", () => {
    const body = { result: { foo: "bar" }, rsp_code: "200", rsp_msg: "success" };
    expect(unwrapEnvelope(body)).toEqual(body);
  });

  it("strips a single-key _response wrapper (aliexpress.ds.text.search shape)", () => {
    const inner = { data: { products: [] }, code: "00", msg: "success" };
    const body = { aliexpress_ds_text_search_response: inner };
    expect(unwrapEnvelope(body)).toEqual(inner);
  });

  it("strips both the _response wrapper and a nested resp_result (aliexpress.ds.category.get shape)", () => {
    const inner = { result: { categories: [] }, resp_code: 200, resp_msg: "success" };
    const body = { aliexpress_ds_category_get_response: { resp_result: inner, request_id: "abc" } };
    expect(unwrapEnvelope(body)).toEqual(inner);
  });

  it("throws on a non-object body", () => {
    expect(() => unwrapEnvelope("not an object")).toThrow();
  });
});

describe("checkEnvelopeSuccess", () => {
  it("treats code '00' as success", () => {
    expect(checkEnvelopeSuccess({ code: "00" })).toEqual({ success: true });
  });

  it("treats rsp_code '200' as success", () => {
    expect(checkEnvelopeSuccess({ rsp_code: "200" })).toEqual({ success: true });
  });

  it("treats resp_code 200 (a number) as success", () => {
    expect(checkEnvelopeSuccess({ resp_code: 200 })).toEqual({ success: true });
  });

  it("treats a missing code field as success", () => {
    expect(checkEnvelopeSuccess({ some: "field" })).toEqual({ success: true });
  });

  it("surfaces a non-zero code as a failure with its message", () => {
    expect(checkEnvelopeSuccess({ code: "15", msg: "insufficient permission" })).toEqual({
      success: false,
      errorCode: "15",
      message: "insufficient permission",
    });
  });

  it("falls back to sub_msg when the primary message field is absent", () => {
    const result = checkEnvelopeSuccess({ rsp_code: "500", sub_msg: "internal error" });
    expect(result).toEqual({ success: false, errorCode: "500", message: "internal error" });
  });
});
