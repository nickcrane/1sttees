"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/admin-auth/config";
import { PRODUCT_TRANSITIONS, isValidTransition, type CurationAction } from "./curation-transitions";

async function requireAdmin(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in as an admin to do that.");
  }
  return { id: session.user.id };
}

function productIdFrom(formData: FormData): string {
  const productId = String(formData.get("productId") ?? "");
  if (!productId) throw new Error("Missing product id.");
  return productId;
}

/**
 * Applies one curation-transitions.ts move: validates the product is
 * actually in an allowed `from` status (re-checked here, not just trusted
 * from whatever the page rendered -- the page could be stale), updates it,
 * and writes the AuditLog entry every admin mutation gets per the schema's
 * own "Rule: spec requires this for admin actions" comment.
 */
async function applyTransition(
  action: CurationAction,
  productId: string,
  extraData: Record<string, unknown> = {}
): Promise<{ id: string; slug: string }> {
  const admin = await requireAdmin();
  const transition = PRODUCT_TRANSITIONS[action];

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Product not found.");
  if (!isValidTransition(action, product.status)) {
    throw new Error(`Can't ${action} a product that's currently ${product.status}.`);
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { status: transition.to, ...extraData },
    select: { id: true, slug: true },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      actorId: admin.id,
      action: transition.auditAction,
      entityType: "Product",
      entityId: productId,
      before: { status: product.status },
      after: { status: transition.to, ...extraData },
    },
  });

  return updated;
}

export async function approveProductAction(formData: FormData): Promise<void> {
  await applyTransition("approve", productIdFrom(formData));
  revalidatePath("/admin/products/candidates");
  revalidatePath("/admin/products/catalogue");
}

export async function rejectProductAction(formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "").trim();
  await applyTransition("reject", productIdFrom(formData), reason ? { rejectReason: reason } : {});
  revalidatePath("/admin/products/candidates");
  revalidatePath("/admin/products/review");
}

export async function parkProductAction(formData: FormData): Promise<void> {
  await applyTransition("park", productIdFrom(formData));
  revalidatePath("/admin/products/candidates");
}

export async function sendToCandidatesAction(formData: FormData): Promise<void> {
  await applyTransition("sendToCandidates", productIdFrom(formData));
  revalidatePath("/admin/products/review");
  revalidatePath("/admin/products/candidates");
}

export async function publishProductAction(formData: FormData): Promise<void> {
  const { slug } = await applyTransition("publish", productIdFrom(formData));
  revalidatePath("/admin/products/catalogue");
  revalidatePath("/products");
  revalidatePath(`/products/${slug}`);
}

export async function unpublishProductAction(formData: FormData): Promise<void> {
  const { slug } = await applyTransition("unpublish", productIdFrom(formData));
  revalidatePath("/admin/products/catalogue");
  revalidatePath("/products");
  revalidatePath(`/products/${slug}`);
}

export async function retireProductAction(formData: FormData): Promise<void> {
  const { slug } = await applyTransition("retire", productIdFrom(formData));
  revalidatePath("/admin/products/catalogue");
  revalidatePath("/products");
  revalidatePath(`/products/${slug}`);
}
