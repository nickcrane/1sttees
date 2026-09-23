import type { Metadata } from "next";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";

export const metadata: Metadata = {
  title: "Coming Soon",
  description: "1st Tees is launching soon. Sign up to be the first to know.",
};

export default function ComingSoonPage() {
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
