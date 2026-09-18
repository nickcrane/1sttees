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
    // Google verifies the email on our behalf, which is what makes this
    // safe: link any guest orders placed under this exact email (still
    // unclaimed) to the now-signed-in account. Runs on every sign-in, not
    // just account creation, so an order placed as a guest after the
    // account already existed still gets claimed on the next sign-in.
    async signIn({ user }) {
      if (!user.email || !user.id) return;
      await prisma.order.updateMany({
        where: { email: user.email, customerId: null },
        data: { customerId: user.id },
      });
    },
  },
});
