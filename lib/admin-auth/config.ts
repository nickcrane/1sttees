import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { edgeAuthConfig } from "./edge-config";
import { verifyPassword } from "./password";
import { verifyTotpCode } from "./totp";
import { checkRateLimit, clearFailedSignIns, getLockoutRemainingSeconds, recordFailedSignIn } from "./rate-limit";
import { logAdminSecurityEvent } from "./security-events";
import { isAllowlistedAdminEmail } from "./allowlist";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

// The full config -- Node-only (argon2, ioredis, prisma), used in route
// handlers and Server Components. Never import this from middleware.ts;
// use lib/admin-auth/edge-config.ts there instead (see its own comment).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...edgeAuthConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password" },
        totpCode: { label: "Authenticator code" },
      },
      // Deliberately returns the same generic failure for every rejection
      // reason (unknown email, wrong password, wrong TOTP, locked out) --
      // matches the spec's no-user-enumeration rule for the customer realm;
      // applied here too since there's no reason an admin login should leak
      // more than a customer one does.
      async authorize(credentials, request) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        const totpCode = String(credentials?.totpCode ?? "");
        const ip = clientIp(request);

        const ipAllowed = await checkRateLimit(`ip:${ip}`, env.AUTH_RATE_LIMIT_PER_MIN, 60);
        const emailAllowed = email ? await checkRateLimit(`email:${email}`, env.AUTH_RATE_LIMIT_PER_MIN, 60) : true;
        if (!ipAllowed || !emailAllowed) {
          logger.warn({ email, ip }, "admin sign-in rate limited");
          return null;
        }

        if (!email || !isAllowlistedAdminEmail(email)) {
          return null;
        }

        const lockedForSeconds = await getLockoutRemainingSeconds(email);
        if (lockedForSeconds > 0) {
          await logAdminSecurityEvent({ email, type: "SIGN_IN_FAILURE", ip });
          return null;
        }

        const adminUser = await prisma.adminUser.findUnique({ where: { email } });
        const fail = async (type: "SIGN_IN_FAILURE" | "TOTP_FAILURE" = "SIGN_IN_FAILURE") => {
          await recordFailedSignIn(email);
          await logAdminSecurityEvent({ email, type, ip, adminUserId: adminUser?.id });
          return null;
        };

        if (!adminUser || !adminUser.passwordHash || !adminUser.encryptedTotpSecret || !adminUser.totpEnabledAt) {
          // Covers "no such admin" and "signup never completed" identically.
          return fail();
        }

        const passwordOk = await verifyPassword(adminUser.passwordHash, password);
        if (!passwordOk) return fail();

        const totpSecret = decryptSecret(adminUser.encryptedTotpSecret);
        const totpOk = verifyTotpCode(email, totpSecret, totpCode);
        if (!totpOk) return fail("TOTP_FAILURE");

        await clearFailedSignIns(email);
        await logAdminSecurityEvent({ email, type: "SIGN_IN_SUCCESS", ip, adminUserId: adminUser.id });

        return { id: adminUser.id, email: adminUser.email };
      },
    }),
  ],
  // callbacks (jwt/session) come from edgeAuthConfig via the spread above --
  // not repeated here, so there's only one place they can drift.
});
