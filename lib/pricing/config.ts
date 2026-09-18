import { env } from "@/lib/env";
import type { LandedCostConfig } from "./calculate";

export function landedCostConfigFromEnv(): LandedCostConfig {
  return {
    fxBufferPct: env.FX_BUFFER_PCT,
    paymentProcessingPct: env.PAYMENT_PROCESSING_PCT,
    paymentProcessingFixedMinor: env.PAYMENT_PROCESSING_FIXED_PENCE,
    returnsReservePct: env.RETURNS_RESERVE_PCT,
  };
}
