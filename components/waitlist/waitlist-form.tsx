"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong -- try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return <p className="text-sm text-muted-foreground">You&apos;re on the list -- we&apos;ll email you when we launch.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="email" className="sr-only">
          Email address
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Signing up..." : "Notify me"}
      </Button>
    </form>
  );
}
