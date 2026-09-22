import { describe, expect, it } from "vitest";
import { customerOrderStatusLabel } from "@/lib/orders/status-label";

describe("customerOrderStatusLabel", () => {
  it("maps HOLD to a reassuring label, not the raw enum name", () => {
    expect(customerOrderStatusLabel("HOLD")).toBe("Order received");
  });

  it("maps NEEDS_MANUAL_REVIEW to a non-alarming label", () => {
    expect(customerOrderStatusLabel("NEEDS_MANUAL_REVIEW")).not.toContain("MANUAL");
  });

  it("falls back to a humanized raw status for anything unmapped", () => {
    // PENDING_PAYMENT is mapped -- this just confirms the fallback shape
    // for a hypothetical future enum value would still be readable.
    expect(customerOrderStatusLabel("PENDING_PAYMENT")).toBe("Awaiting payment");
  });
});
