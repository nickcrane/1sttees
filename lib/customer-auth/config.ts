import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// Runs in the Node runtime only (Server Components, route handlers) --
// unlike admin auth, there's no middleware/Edge split here: customer
// routes are protected by checking auth() directly in a layout/page,
// which is the standard App Router pattern and avoids re-fighting the
// Edge Runtime's inability to bundle Prisma/argon2-style Node built-ins
// (see lib/admin-auth/edge-config.ts's own comment on that).
const isProduction = env.NODE_ENV === "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  basePath: "/api/auth/customer",
  secret: env.CUSTOMER_AUTH_SECRET,
  trustHost: true,
  // Database sessions, not JWT -- Auth.js already needs the adapter/tables
  // to link a Google account to a User, so a Session table alongside them
  // is effectively free, and it buys instant server-side revocation (ban a
  // user, force sign-out) that a JWT-only session can't do without extra
  // infrastructure. See docs/decisions.md for the fuller writeup.
  session: { strategy: "database" },
  cookies: {
    // Same __Host-/Secure-in-prod-only convention as
    // lib/admin-auth/edge-config.ts, and a distinct name so the two
    // realms' cookies never collide when both are signed in in one browser.
    sessionToken: {
      name: isProduction ? "__Host-customer-session" : "customer-session-token",
      options: { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" },
    },
  },
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  events: {
    // Auth.js's OAuth flow hard-codes emailVerified: null when it creates
    // a user, regardless of what a provider's profile() callback returns
    // (confirmed by reading @auth/core's handle-login.js -- it spreads
    // profile() first, then explicitly overwrites emailVerified: null
    // right after; the customary fix is exactly this, a post-creation
    // update). A profile() override is not enough on its own -- confirmed
    // live: it left User.emailVerified null despite Google's email_verified
    // claim being true. Trusting Google's claim here is what backs the
    // guest-order-claiming update below (runs on every sign-in, not just
    // account creation, so an order placed as a guest after the account
    // already existed still gets claimed on the next sign-in).
    async signIn({ user, account, profile }) {
      if (!user.email || !user.id) return;

      if (account?.provider === "google" && profile?.email_verified) {
        await prisma.user.updateMany({
          where: { id: user.id, emailVerified: null },
          data: { emailVerified: new Date() },
        });
      }

      await prisma.order.updateMany({
        where: { email: user.email, customerId: null },
        data: { customerId: user.id },
      });
    },
  },
});
