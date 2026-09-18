import type { Metadata } from "next";
import Link from "next/link";
import { GoogleSignInButton, SignOutButton } from "@/components/storefront/auth-buttons";
import { auth } from "@/lib/customer-auth/config";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-4 py-20 text-center">
        <h1 className="font-heading text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to view your order history and manage saved addresses.
        </p>
        <GoogleSignInButton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-20">
      <div>
        <h1 className="font-heading text-2xl font-semibold">
          {session.user.name ? `Hi, ${session.user.name.split(" ")[0]}` : "Your account"}
        </h1>
        <p className="text-sm text-muted-foreground">{session.user.email}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Link href="/account/orders" className="text-sm underline">
          Order history
        </Link>
        <Link href="/account/addresses" className="text-sm underline">
          Saved addresses
        </Link>
      </div>
      <SignOutButton />
    </div>
  );
}
