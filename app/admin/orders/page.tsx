import type { OrderStatus } from "@prisma/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";

// This page doesn't call auth() itself (middleware already gates
// /admin/:path*), so Next.js has no signal to treat it as dynamic on its
// own -- confirmed live it got prerendered as a static route at build
// time otherwise, which would show build-time-stale order data forever.
export const dynamic = "force-dynamic";

const ATTENTION_STATUSES: OrderStatus[] = ["NEEDS_MANUAL_REVIEW", "SUPPLIER_ORDER_PLACED"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  NEEDS_MANUAL_REVIEW: "destructive",
  SUPPLIER_ORDER_PLACED: "secondary",
  PAID: "outline",
  SHIPPED: "secondary",
  DELIVERED: "default",
  CANCELLED: "outline",
};

export default async function AdminOrdersPage() {
  const [attentionOrders, recentOrders] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ATTENTION_STATUSES } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <Link href="/admin" className="text-sm underline">
          Back to admin
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Needs attention</h2>
        {attentionOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {attentionOrders.map((order) => (
              <Card key={order.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{order.orderNumber}</CardTitle>
                    <Badge variant={STATUS_VARIANT[order.status] ?? "outline"}>{order.status.replace(/_/g, " ")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <p>
                    {order.email} &middot; {formatMinor(order.totalMinor, order.currency)}
                  </p>
                  {order.status === "NEEDS_MANUAL_REVIEW" && order.fulfilmentError && (
                    <p className="text-destructive">{order.fulfilmentError}</p>
                  )}
                  {order.status === "SUPPLIER_ORDER_PLACED" && (
                    <p className="text-muted-foreground">
                      Placed with AliExpress ({order.supplierOrderIds.join(", ")}) -- auto-pay isn&rsquo;t enabled
                      yet, pay this order manually on AliExpress.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent orders</h2>
        <div className="flex flex-col gap-2">
          {recentOrders.map((order) => (
            <div key={order.id} className="flex items-center justify-between border-b border-border py-2 text-sm">
              <div>
                <p className="font-medium">{order.orderNumber}</p>
                <p className="text-muted-foreground">{order.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span>{formatMinor(order.totalMinor, order.currency)}</span>
                <Badge variant={STATUS_VARIANT[order.status] ?? "outline"}>{order.status.replace(/_/g, " ")}</Badge>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
