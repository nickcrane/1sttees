import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/prisma";
import {
  addKeywordAction,
  deactivateKeywordAction,
  deleteKeywordAction,
  reactivateKeywordAction,
} from "@/lib/catalog/keyword-actions";

export const dynamic = "force-dynamic";

export default async function AdminKeywordsPage() {
  const keywords = await prisma.discoverySeedKeyword.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Discovery keywords</h1>
        <Link href="/" className="text-sm underline">
          Back to admin
        </Link>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link href="/products/candidates" className="text-muted-foreground underline">
          Candidates
        </Link>
        <Link href="/products/review" className="text-muted-foreground underline">
          Review queue
        </Link>
        <Link href="/products/catalogue" className="text-muted-foreground underline">
          Catalogue
        </Link>
        <span className="font-medium">Keywords</span>
      </nav>

      <p className="text-sm text-muted-foreground">
        The seed list the nightly discovery job searches on AliExpress (lib/catalog/discovery.ts&rsquo;s Stage 1).
        There&rsquo;s no material filter in the supplier API, so keep these broad -- the classifier sorts wooden/
        bamboo from everything else afterwards. Only active keywords are searched.
      </p>

      <Card>
        <CardContent className="pt-6">
          <form action={addKeywordAction} className="flex gap-2">
            <Input type="text" name="keyword" placeholder="e.g. bamboo golf tee" required className="max-w-sm" />
            <Button type="submit" size="sm">
              Add keyword
            </Button>
          </form>
        </CardContent>
      </Card>

      {keywords.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No keywords yet -- add one above to give discovery something to search.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {keywords.map((keyword) => (
            <Card key={keyword.id}>
              <CardContent className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm">{keyword.keyword}</span>
                  {!keyword.active && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="flex gap-2">
                  {keyword.active ? (
                    <form action={deactivateKeywordAction}>
                      <input type="hidden" name="id" value={keyword.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Deactivate
                      </Button>
                    </form>
                  ) : (
                    <form action={reactivateKeywordAction}>
                      <input type="hidden" name="id" value={keyword.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Reactivate
                      </Button>
                    </form>
                  )}
                  <form action={deleteKeywordAction}>
                    <input type="hidden" name="id" value={keyword.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
