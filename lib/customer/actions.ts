"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/customer-auth/config";
import { createAddress, deleteAddress, setDefaultAddress } from "@/lib/customer/addresses";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in to do that.");
  }
  return session.user.id;
}

export async function addAddressAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();

  const name = String(formData.get("name") ?? "").trim();
  const line1 = String(formData.get("line1") ?? "").trim();
  const line2 = String(formData.get("line2") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const isDefault = formData.get("isDefault") === "on";

  if (!name || !line1 || !city || !postcode || !country) {
    throw new Error("Please fill in all required address fields.");
  }

  await createAddress(userId, {
    name,
    line1,
    line2: line2 || undefined,
    city,
    postcode,
    country,
    label: label || undefined,
    isDefault,
  });

  revalidatePath("/account/addresses");
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const addressId = String(formData.get("addressId") ?? "");
  if (!addressId) throw new Error("Missing address id.");

  await deleteAddress(userId, addressId);
  revalidatePath("/account/addresses");
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const addressId = String(formData.get("addressId") ?? "");
  if (!addressId) throw new Error("Missing address id.");

  await setDefaultAddress(userId, addressId);
  revalidatePath("/account/addresses");
}
