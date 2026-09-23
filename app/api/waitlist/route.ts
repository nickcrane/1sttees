import { NextResponse } from "next/server";
import { waitlistSignupSchema, submitWaitlistSignup, WaitlistRateLimitError } from "@/lib/waitlist/signup";

// Railway (and most PaaS hosts) sit behind a proxy that sets this --
// there's no direct socket IP available to a Next.js route handler here.
// Falls back to a shared bucket if the header's ever absent (local dev
// without a proxy in front), which just means local requests share one
// rate-limit counter -- acceptable since it's not internet-facing there.
function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const parsed = waitlistSignupSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    await submitWaitlistSignup(parsed.data, clientIp(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WaitlistRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }
}
