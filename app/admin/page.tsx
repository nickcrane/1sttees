import Link from "next/link";
import { auth } from "@/lib/admin-auth/config";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminDashboardPage() {
  const session = await auth();
  const [supplierProductCount, productCount, publishedCount] = await Promise.all([
    prisma.supplierProduct.count(),
    prisma.product.count(),
    prisma.product.count({ where: { status: "PUBLISHED" } }),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">Signed in as {session?.user?.email}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Supplier products</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{supplierProductCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Merchandised products</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{productCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Published</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{publishedCount}</CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2">
        <Link href="/admin/orders" className="text-sm underline">
          Orders &rarr;
        </Link>
      </div>
    </main>
  );
}
