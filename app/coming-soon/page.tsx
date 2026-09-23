import type { Metadata } from "next";
import { ComingSoonContent } from "@/components/waitlist/coming-soon-content";

export const metadata: Metadata = {
  title: "Coming Soon",
  description: "1st Tees is launching soon. Sign up to be the first to know.",
};

export default function ComingSoonPage() {
  return <ComingSoonContent />;
}
