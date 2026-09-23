import { WaitlistForm } from "@/components/waitlist/waitlist-form";

/**
 * Shared between app/coming-soon (a stable, always-reachable preview URL --
 * useful for linking before the flag flips, and for e2e coverage without
 * needing COMING_SOON_MODE on) and app/(storefront)/page.tsx (the real
 * home page, which renders this in place of the normal storefront content
 * when COMING_SOON_MODE is on -- see that page and middleware.ts's
 * comment for why the home route itself, not a redirect target, needs to
 * be the one showing this).
 */
export function ComingSoonContent() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-20 text-center">
      <h1 className="font-heading text-4xl font-semibold sm:text-5xl">1st Tees</h1>
      <p className="max-w-md text-muted-foreground">
        Sustainable bamboo golf tees, shipped to the UK and EU. We&apos;re putting the finishing
        touches on the shop -- leave your email and we&apos;ll let you know the moment we launch.
      </p>
      <WaitlistForm />
    </main>
  );
}
