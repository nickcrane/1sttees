import { z } from "zod";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

export const waitlistSignupSchema = z.object({
  email: z.email(),
});

export type WaitlistSignupInput = z.infer<typeof waitlistSignupSchema>;

const RATE_LIMIT_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

export class WaitlistRateLimitError extends Error {
  constructor() {
    super("Too many signups from this address recently -- try again shortly.");
    this.name = "WaitlistRateLimitError";
  }
}

/** The subset of ioredis's API this needs -- lets tests inject a fake instead of a real Redis connection. */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export async function checkRateLimit(identifier: string, store: RateLimitStore): Promise<boolean> {
  const key = `waitlist:rate:${identifier}`;
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  return count <= RATE_LIMIT_PER_WINDOW;
}

let cachedResend: Resend | null = null;
function getResendClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  cachedResend ??= new Resend(env.RESEND_API_KEY);
  return cachedResend;
}

// Requires this address's domain to be verified in the Resend dashboard
// before sending actually works -- confirmation email failing (see catch
// below) doesn't block a signup either way, so this isn't load-bearing
// for the feature itself, just a nice-to-have on top of it.
const FROM_ADDRESS = "1st Tees <hello@1sttees.golf>";

async function sendConfirmationEmail(email: string): Promise<void> {
  const client = getResendClient();
  if (!client) {
    logger.warn("waitlist: RESEND_API_KEY not set, skipping confirmation email");
    return;
  }
  try {
    await client.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: "You're on the list -- 1st Tees",
      html: "<p>Thanks for signing up. We'll email you the moment 1st Tees launches.</p>",
    });
  } catch (error) {
    // Never fatal to the signup -- the email's already stored (the
    // source of truth); the confirmation is a nice-to-have on top.
    logger.warn({ error }, "waitlist: confirmation email failed to send");
  }
}

/**
 * Records a waitlist signup, rate-limited per caller-supplied identifier
 * (the route handler passes the request IP) to deter abuse. Upserts by
 * email so a repeat submission is a silent no-op, not an error -- and
 * never reveals to the caller whether the address had already signed up,
 * basic enumeration hygiene for a public, unauthenticated endpoint.
 */
export async function submitWaitlistSignup(
  input: WaitlistSignupInput,
  rateLimitKey: string,
  store: RateLimitStore = redis
): Promise<void> {
  const allowed = await checkRateLimit(rateLimitKey, store);
  if (!allowed) throw new WaitlistRateLimitError();

  const { email } = input;
  await prisma.waitlistSignup.upsert({
    where: { email },
    create: { email },
    update: {},
  });

  await sendConfirmationEmail(email);
}
