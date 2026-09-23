import { Footer } from "@/components/storefront/footer";
import { Header } from "@/components/storefront/header";
import { env } from "@/lib/env";

// Every page under this group was implicitly dynamic only because Header
// (rendered by this layout on every one of them) reads cookies via
// getCart()/auth() -- a dynamic API anywhere in a route's tree opts the
// whole route out of static generation. Confirmed live: turning
// COMING_SOON_MODE on removed Header from the tree below, which silently
// removed that implicit signal too, so `next build` tried to statically
// prerender /products (and would have for every other page here) and
// failed hitting Postgres from Railway's network-isolated builder --
// exactly the class of bug already fixed once for app/sitemap.ts, just
// arrived at from the opposite direction this time. Forcing it explicitly
// here means no future change to Header, or to any one page, can silently
// re-introduce the same failure for the rest of the group.
export const dynamic = "force-dynamic";

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  // While COMING_SOON_MODE is on, middleware.ts redirects every storefront
  // route except "/" away, so this group only ever actually renders the
  // Coming Soon content (which provides its own <main>) -- go chrome-free
  // rather than wrap a holding page in a nav bar pointing at a shop that
  // isn't reachable yet.
  if (env.COMING_SOON_MODE === "true") {
    return children;
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <Header />
      <main className="flex flex-1 flex-col">{children}</main>
      <Footer />
    </div>
  );
}
