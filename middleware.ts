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

// Stays reachable even when COMING_SOON_MODE gates the rest of the
// public site -- the holding page's own infrastructure (page + its API
// route) plus the two files crawlers/webhooks poll directly regardless
// of whether the storefront itself is live.
const COMING_SOON_EXEMPT_PATHS = new Set(["/coming-soon", "/api/waitlist", "/robots.txt", "/sitemap.xml"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if (isAdminRoute) {
    const isPublicAdminPath = PUBLIC_ADMIN_PATHS.has(pathname);
    if (!isPublicAdminPath && !req.auth) {
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const loginUrl = new URL("/admin/login", req.nextUrl.origin);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return;
  }

  // process.env directly, not lib/env.ts -- this file runs on the Edge
  // runtime, which lib/env.ts's dotenv/process.cwd() usage can't bundle
  // (same reason edge-config.ts exists as a separate NextAuth config).
  const comingSoonMode = process.env.COMING_SOON_MODE === "true";
  if (comingSoonMode && !pathname.startsWith("/api/webhooks") && !COMING_SOON_EXEMPT_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL("/coming-soon", req.nextUrl.origin));
  }
});

// Broadened from the original /admin + /api/admin-only matcher to also
// cover the public storefront, so the Coming Soon gate above can run --
// confirmed live gap during development for the *original*, narrower
// matcher: the API routes weren't covered by an even earlier version
// that only listed /admin/:path*, which would have left /api/admin/**
// completely unauthenticated. See tests/e2e/admin-isolation.spec.ts for
// the proof that's stayed true through this broadening, and
// tests/e2e/coming-soon.spec.ts for the new gate's own coverage.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
