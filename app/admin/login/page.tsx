"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      totpCode,
      redirect: false,
    });

    setSubmitting(false);
    if (result?.error) {
      // Deliberately generic -- never reveals whether the email, password,
      // or TOTP code was the wrong part.
      setError("Sign-in failed. Check your email, password, and authenticator code.");
      return;
    }
    router.push(searchParams.get("from") || "/");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Admin sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="totpCode">Authenticator code</Label>
            <Input
              id="totpCode"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Suspense>
        <AdminLoginForm />
      </Suspense>
    </main>
  );
}
