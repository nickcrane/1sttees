"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ImportResponse {
  product: { id: string; slug: string; title: string; status: string };
  variantCount: number;
  anyBelowFloorMargin: boolean;
}

export default function ImportProductPage() {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    const res = await fetch("/api/admin/products/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIdOrUrl: input }),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Import failed");
      return;
    }
    setResult(body);
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <Link href="/admin" className="text-sm underline">
        &larr; Dashboard
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Import a product from AliExpress</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleImport} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="input">Product URL or ID</Label>
              <Input
                id="input"
                required
                placeholder="https://www.aliexpress.com/item/1005006525360508.html"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Importing..." : "Import"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>{result.product.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {result.variantCount} variant{result.variantCount === 1 ? "" : "s"} imported.
            </p>
            <div className="flex items-center gap-2">
              <Badge variant={result.product.status === "PUBLISHED" ? "default" : "secondary"}>
                {result.product.status}
              </Badge>
              {result.anyBelowFloorMargin && (
                <Badge variant="destructive">Below floor margin -- left as draft</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Slug: {result.product.slug}</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
