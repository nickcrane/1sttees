import { describe, expect, it } from "vitest";
import { landedCostConfigFromEnv } from "@/lib/pricing/config";

describe("landedCostConfigFromEnv", () => {
  it("reads all four landed-cost config fields from env, using the documented defaults", () => {
    const config = landedCostConfigFromEnv();
    expect(config).toEqual({
      fxBufferPct: 3,
      paymentProcessingPct: 1.5,
      paymentProcessingFixedMinor: 20,
      returnsReservePct: 2,
    });
  });
});
