"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/admin-auth/config";

async function requireAdmin(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in as an admin to do that.");
  }
  return { id: session.user.id };
}

export async function addKeywordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const keyword = String(formData.get("keyword") ?? "").trim();
  if (!keyword) throw new Error("Keyword can't be empty.");

  // Upsert rather than a plain create -- re-adding a keyword an admin
  // previously deactivated should reactivate that row (keeping its
  // history/id) instead of throwing on the unique constraint.
  const row = await prisma.discoverySeedKeyword.upsert({
    where: { keyword },
    create: { keyword },
    update: { active: true },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      actorId: admin.id,
      action: "DISCOVERY_KEYWORD_ADDED",
      entityType: "DiscoverySeedKeyword",
      entityId: row.id,
      after: { keyword: row.keyword, active: row.active },
    },
  });

  revalidatePath("/admin/products/keywords");
}

function keywordIdFrom(formData: FormData): string {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing keyword id.");
  return id;
}

export async function deactivateKeywordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = keywordIdFrom(formData);

  const row = await prisma.discoverySeedKeyword.update({ where: { id }, data: { active: false } });

  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      actorId: admin.id,
      action: "DISCOVERY_KEYWORD_DEACTIVATED",
      entityType: "DiscoverySeedKeyword",
      entityId: row.id,
      before: { active: true },
      after: { active: false },
    },
  });

  revalidatePath("/admin/products/keywords");
}

export async function reactivateKeywordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = keywordIdFrom(formData);

  const row = await prisma.discoverySeedKeyword.update({ where: { id }, data: { active: true } });

  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      actorId: admin.id,
      action: "DISCOVERY_KEYWORD_REACTIVATED",
      entityType: "DiscoverySeedKeyword",
      entityId: row.id,
      before: { active: false },
      after: { active: true },
    },
  });

  revalidatePath("/admin/products/keywords");
}

// Hard delete rather than a third status -- unlike products, a keyword has
// no downstream state (SupplierProduct.discoverySource stores the keyword
// text, not a foreign key) that a delete would orphan, so there's no
// reason to force "deactivated forever" over actually removing it.
export async function deleteKeywordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = keywordIdFrom(formData);

  const row = await prisma.discoverySeedKeyword.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      actorId: admin.id,
      action: "DISCOVERY_KEYWORD_DELETED",
      entityType: "DiscoverySeedKeyword",
      entityId: row.id,
      before: { keyword: row.keyword, active: row.active },
    },
  });

  revalidatePath("/admin/products/keywords");
}
