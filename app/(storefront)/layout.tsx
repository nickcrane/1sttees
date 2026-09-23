import { Footer } from "@/components/storefront/footer";
import { Header } from "@/components/storefront/header";
import { env } from "@/lib/env";

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
