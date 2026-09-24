"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Step = "credentials" | "totp";

export default function AdminSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secretBase32, setSecretBase32] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStartSetup(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // A server-side crash (e.g. a misconfigured env var) returns Next's
      // default HTML error page, not JSON -- res.json() throws on that.
      // Confirmed live: without the try/catch below, that exception
      // skipped setSubmitting(false) entirely, leaving the button stuck
      // on "Starting..." forever with no error shown -- indistinguishable
      // from a genuine hang to whoever's looking at it.
      const body = await res.json().catch(() => ({ error: "Setup failed unexpectedly -- check server logs." }));
      if (!res.ok) {
        setError(body.error ?? "Setup failed");
        return;
      }
      setQrCodeDataUrl(body.qrCodeDataUrl);
      setSecretBase32(body.secretBase32);
      setStep("totp");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmTotp(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/setup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const body = await res.json().catch(() => ({ error: "Confirmation failed unexpectedly -- check server logs." }));
      if (!res.ok) {
        setError(body.error ?? "Confirmation failed");
        return;
      }
      router.push("/login");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Admin account setup</CardTitle>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form onSubmit={handleStartSetup} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Only emails on the admin allowlist can complete setup.</p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password (min. 12 characters)</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Starting..." : "Continue"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleConfirmTotp} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Scan this with your authenticator app (Google Authenticator, 1Password, etc.), or enter the key
                manually, then confirm with a code.
              </p>
              {qrCodeDataUrl && (
                <Image src={qrCodeDataUrl} alt="Authenticator QR code" width={200} height={200} className="mx-auto" unoptimized />
              )}
              {secretBase32 && (
                <p className="break-all text-center font-mono text-xs text-muted-foreground">{secretBase32}</p>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Confirming..." : "Confirm and finish setup"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
