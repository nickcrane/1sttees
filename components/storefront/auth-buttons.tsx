import { Button } from "@/components/ui/button";
import { signIn, signOut } from "@/lib/customer-auth/config";

export function GoogleSignInButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: callbackUrl ?? "/account" });
      }}
    >
      <Button type="submit">Sign in with Google</Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" variant="outline">
        Sign out
      </Button>
    </form>
  );
}
