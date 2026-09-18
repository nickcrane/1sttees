import { describe, expect, it } from "vitest";
import { formatMinor } from "@/lib/money";

describe("formatMinor", () => {
  it("formats pence as GBP by default", () => {
    expect(formatMinor(1999)).toBe("£19.99");
  });

  it("formats a whole-pound amount without dropping the decimals", () => {
    expect(formatMinor(500)).toBe("£5.00");
  });

  it("formats zero", () => {
    expect(formatMinor(0)).toBe("£0.00");
  });

  it("respects an explicit currency", () => {
    expect(formatMinor(1999, "EUR")).toBe("€19.99");
  });
});
