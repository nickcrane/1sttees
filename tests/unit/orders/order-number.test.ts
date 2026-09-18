import { describe, expect, it } from "vitest";
import { generateOrderNumber } from "@/lib/orders/order-number";

describe("generateOrderNumber", () => {
  it("matches the 1ST-YYYYMMDD-XXXXXX format", () => {
    expect(generateOrderNumber(new Date("2026-09-18T12:00:00Z"))).toMatch(/^1ST-20260918-[0-9A-F]{6}$/);
  });

  it("generates a different suffix on each call", () => {
    const a = generateOrderNumber();
    const b = generateOrderNumber();
    expect(a).not.toBe(b);
  });
});
