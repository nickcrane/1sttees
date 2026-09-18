import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { edgeAuthConfig } from "@/lib/admin-auth/edge-config";

// A separate, edge-safe NextAuth instance -- see edge-config.ts's comment
// for why this can't import lib/admin-auth/config.ts (its Credentials
// provider pulls in argon2/ioredis/node:crypto, none of which the Edge
// runtime middleware.ts executes in can bundle). Same secret and cookie
// name as the full instance, so it reads the same session cookie fine.
const { auth } = NextAuth(edgeAuthConfig);

// The setup routes must stay reachable pre-auth (they're how the first
// admin bootstraps an account); everything else under /admin and
// /api/admin requires a session.
const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/setup", "/api/admin/setup", "/api/admin/setup/confirm"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isPublicAdminPath = PUBLIC_ADMIN_PATHS.has(pathname);

  if (isAdminRoute && !isPublicAdminPath && !req.auth) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", req.nextUrl.origin);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }
});

// Covers both the admin UI and its API routes -- confirmed live gap during
// development: the API routes weren't covered by an earlier version of
// this matcher that only listed /admin/:path*, which would have left
// /api/admin/** completely unauthenticated. See
// tests/e2e/admin-isolation.spec.ts for the proof this stays true.
export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
