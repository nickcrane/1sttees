"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetches the current (server-rendered) route every couple of seconds --
 * used on the confirmation page while an order is still PENDING_PAYMENT,
 * since the webhook that flips it to PAID can lag a moment behind the
 * browser's own redirect back from Stripe/PayPal. Stops after ~20s; if the
 * webhook still hasn't landed by then the page's own static fallback copy
 * takes over rather than polling forever.
 */
export function OrderStatusPoller() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 2000);
    const timeout = setTimeout(() => clearInterval(interval), 20000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [router]);

  return null;
}
