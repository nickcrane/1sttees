import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/customer-auth/config";
import { formatMinor } from "@/lib/money";
import { customerOrderStatusLabel } from "@/lib/orders/status-label";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Order history" };

export default async function OrderHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/account");

  const orders = await prisma.order.findMany({
    where: { customerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Order history</h1>
        <Link href="/account" className="text-sm underline">
          Back to account
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No orders yet -- your past orders will show up here once you check out.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((order) => (
            <li key={order.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{order.orderNumber}</span>
                <span className="text-muted-foreground">{customerOrderStatusLabel(order.status)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {order.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </p>
              <ul className="flex flex-col gap-1">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between text-sm">
                    <span>
                      {item.titleSnapshot} ({item.variantTitleSnapshot}) &times; {item.quantity}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-border pt-2 text-sm font-medium">
                <span>Total</span>
                <span>{formatMinor(order.totalMinor, order.currency)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
