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
// /api/admin requires a session. Keyed on the real (file-route) path --
// see toRealAdminPath/toVisibleAdminPath below for how a subdomain
// request gets mapped onto these before this check runs.
const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/setup", "/api/admin/setup", "/api/admin/setup/confirm"]);

// Stays reachable even when COMING_SOON_MODE gates the rest of the
// public site. "/" is exempt because it *is* the destination everything
// else redirects to -- app/(storefront)/page.tsx renders the holding
// page there directly rather than this middleware bouncing visitors
// through a separate /coming-soon URL, so the home page itself never
// shows a redirect in the address bar. /coming-soon stays reachable too,
// as a stable, always-on preview URL independent of the flag (handy for
// linking pre-launch, and lets tests/e2e/coming-soon.spec.ts exercise
// the page without needing COMING_SOON_MODE set). /api/waitlist,
// /robots.txt and /sitemap.xml are the remaining infrastructure crawlers
// and the form itself need regardless of whether the storefront is live.
const COMING_SOON_EXEMPT_PATHS = new Set(["/", "/coming-soon", "/api/waitlist", "/robots.txt", "/sitemap.xml"]);

// process.env directly, not lib/env.ts -- this file runs on the Edge
// runtime, which lib/env.ts's dotenv/process.cwd() usage can't bundle
// (same reason edge-config.ts exists as a separate NextAuth config).
// Per-environment (admin.1sttees.golf / admin.test.1sttees.golf), unset
// in CI/anywhere it doesn't apply -- isAdminHost's admin.localhost
// fallback covers local dev regardless.
const ADMIN_HOSTNAME = process.env.ADMIN_HOSTNAME;

function isAdminHost(hostname: string): boolean {
  // Modern browsers resolve *.localhost to 127.0.0.1 without any
  // /etc/hosts edit, so this works in local dev with no extra setup --
  // confirmed for Chrome/Firefox/Safari.
  return hostname === "admin.localhost" || (!!ADMIN_HOSTNAME && hostname === ADMIN_HOSTNAME);
}

// API routes keep their real path on every host -- they're called by
// fetch()/form actions from whatever page rendered them, never
// link-navigated, so there's no browser-visible URL to clean up here the
// way there is for pages.
function isAdminApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/admin") || pathname.startsWith("/api/auth/admin");
}

/** Browser-visible path on the admin subdomain -> the real /admin/* file route it maps to ("/" -> "/admin", "/orders" -> "/admin/orders"). API paths pass through unchanged (see isAdminApiPath). */
function toRealAdminPath(pathname: string): string {
  if (isAdminApiPath(pathname) || pathname.startsWith("/admin")) return pathname;
  return pathname === "/" ? "/admin" : `/admin${pathname}`;
}

/** The inverse -- a real /admin/* file route -> the clean path it should show as on the admin subdomain ("/admin" -> "/", "/admin/orders" -> "/orders"). Used for login/setup redirect targets so the address bar never shows a redundant /admin. */
function toVisibleAdminPath(pathname: string): string {
  if (pathname === "/admin") return "/";
  if (pathname.startsWith("/admin/")) return pathname.slice("/admin".length);
  return pathname;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  // Deliberately read from the `Host` header, not req.nextUrl.hostname/
  // .origin -- confirmed live in `next dev`: req.nextUrl is built from
  // the dev server's own bind address ("localhost"), NOT the incoming
  // request's actual Host header, so req.nextUrl.hostname stayed
  // "localhost" even for a request that genuinely arrived as
  // `Host: admin.localhost:3000` -- silently routing every admin-
  // subdomain request as if it were the main site instead of rewriting/
  // redirecting it. The Host header reflects the real value in both dev
  // and prod. `X-Forwarded-Host` takes priority over `Host` -- confirmed
  // live on Railway: its edge proxy (`server: railway-hikari`) rewrites
  // `Host` to something internal before the request reaches this app, so
  // a request that genuinely arrived at admin.test.1sttees.golf was
  // silently evaluating as the main site instead of the admin host.
  // `X-Forwarded-Host` carries the real value the client actually used.
  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const hostname = hostHeader.split(":")[0] ?? "";
  const onAdminHost = isAdminHost(hostname);
  const requestOrigin = `${req.nextUrl.protocol}//${hostHeader}`;
  // Only ever non-empty in local dev (":3000") -- a real custom domain's
  // Host/X-Forwarded-Host never carries an explicit port over HTTPS.
  const incomingPortSuffix = hostHeader.includes(":") ? hostHeader.slice(hostHeader.indexOf(":")) : "";

  // The subdomain is now the only supported way into any admin page --
  // reject /admin/* browsed on the storefront's own host by bouncing to
  // the equivalent clean URL on the admin host instead of a confusing
  // 404. Admin API routes are exempt (see isAdminApiPath) since nothing
  // ever navigates to them directly.
  if (!onAdminHost && pathname.startsWith("/admin") && !isAdminApiPath(pathname)) {
    if (ADMIN_HOSTNAME) {
      // Built from ADMIN_HOSTNAME + incomingPortSuffix, not
      // req.nextUrl.clone() -- confirmed live on Railway: nextUrl's port
      // is the container's *internal* one (8080), which isn't part of
      // the actual client-facing URL at all, so cloning it and swapping
      // just the hostname produced admin.test.1sttees.golf:8080.
      const url = new URL(
        `${toVisibleAdminPath(pathname)}${req.nextUrl.search}`,
        `${req.nextUrl.protocol}//${ADMIN_HOSTNAME}${incomingPortSuffix}`
      );
      return NextResponse.redirect(url);
      // No ADMIN_HOSTNAME configured for this environment (e.g. CI) --
      // falls through and keeps serving /admin/* on this host directly,
      // same as before subdomain routing existed.
    }
  }

  const realPathname = onAdminHost ? toRealAdminPath(pathname) : pathname;
  // /api/auth/admin/* (NextAuth's own handler) deliberately excluded from
  // the gate below -- confirmed live: treating it the same as /api/admin
  // broke sign-in entirely. Its csrf/session/signin/callback endpoints
  // must stay reachable *without* a session (that's how one gets
  // created); gating them made next-auth/react's client fetches get
  // redirected to the login page's HTML instead of getting back JSON,
  // surfacing as "Unexpected token '<'" ClientFetchError in the browser.
  // The pre-subdomain-routing version of this file never gated this path
  // either -- NextAuth's handler manages its own internal auth logic.
  const isGatedAdminRoute = realPathname.startsWith("/admin") || realPathname.startsWith("/api/admin");
  const isNextAuthAdminRoute = realPathname.startsWith("/api/auth/admin");

  if (isGatedAdminRoute) {
    const isPublicAdminPath = PUBLIC_ADMIN_PATHS.has(realPathname);
    if (!isPublicAdminPath && !req.auth) {
      if (realPathname.startsWith("/api/admin")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // Always the clean path -- reached either from the admin host
      // directly, or (no-ADMIN_HOSTNAME fallback above) from /admin/*
      // on the main host, in which case realPathname === pathname and
      // this still resolves correctly.
      const loginUrl = new URL(onAdminHost ? "/login" : "/admin/login", requestOrigin);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (isGatedAdminRoute || isNextAuthAdminRoute) {
    if (realPathname !== pathname) {
      const url = req.nextUrl.clone();
      url.pathname = realPathname;
      return NextResponse.rewrite(url);
    }
    return;
  }

  const comingSoonMode = process.env.COMING_SOON_MODE === "true";
  if (comingSoonMode && !pathname.startsWith("/api/webhooks") && !COMING_SOON_EXEMPT_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL("/", requestOrigin));
  }
});

// Broadened from the original /admin + /api/admin-only matcher to also
// cover the public storefront, so the Coming Soon gate above can run --
// confirmed live gap during development for the *original*, narrower
// matcher: the API routes weren't covered by an even earlier version
// that only listed /admin/:path*, which would have left /api/admin/**
// completely unauthenticated. See tests/e2e/admin-isolation.spec.ts for
// the proof that's stayed true through this broadening, and
// tests/e2e/coming-soon.spec.ts for the new gate's own coverage. Applies
// per-path regardless of hostname, so this also covers every request
// arriving on the admin subdomain.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
