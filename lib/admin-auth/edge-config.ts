import type { NextAuthConfig } from "next-auth";

/**
 * The subset of the admin auth config that's safe to run in the Edge
 * runtime middleware.ts executes in by default. No providers here --
 * confirmed live that pulling in the full Credentials provider (argon2,
 * ioredis, node:crypto) breaks the build with "Reading from node:crypto is
 * not handled" (Webpack/Edge can't bundle Node built-ins). Middleware only
 * needs to *read* an existing JWT session cookie, which needs just the
 * secret/cookie/session settings below, not the ability to authenticate a
 * new sign-in -- that's what lib/admin-auth/config.ts (Node-only, used in
 * route handlers and Server Components) is for.
 *
 * Deliberately reads `process.env` directly rather than importing
 * `@/lib/env` -- confirmed live that lib/env.ts's `dotenv.config()` call
 * uses `process.cwd()` internally, which the Edge runtime also disallows
 * ("A Node.js API is used (process.cwd) which is not supported"). Next.js
 * already populates `process.env` for Edge middleware on its own, without
 * needing dotenv, so reading it directly here sidesteps the problem rather
 * than working around it.
 */
const isProduction = process.env.NODE_ENV === "production";

export const edgeAuthConfig: NextAuthConfig = {
  basePath: "/api/auth/admin",
  secret: process.env.ADMIN_AUTH_SECRET,
  session: { strategy: "jwt" },
  trustHost: true,
  cookies: {
    // The `__Host-` prefix requires `Secure: true` or the browser silently
    // refuses to set the cookie at all -- confirmed live: sign-in
    // succeeded server-side every time (authorize() returned a user, no
    // error), but the browser never actually stored the session cookie
    // over plain http://localhost in dev, so the very next request looked
    // signed-out again. Matches NextAuth's own convention of only using a
    // secure-cookie prefix in production, plain name otherwise.
    sessionToken: {
      name: isProduction ? "__Host-admin-session" : "admin-session-token",
      options: { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" },
    },
  },
  pages: {
    signIn: "/admin/login",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.adminUserId = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = String(token.adminUserId ?? "");
      return session;
    },
  },
};
