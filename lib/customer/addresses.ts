import type { Address } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AddressInput } from "@/lib/orders/types";

export function listAddresses(userId: string): Promise<Address[]> {
  return prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
}

export interface SaveAddressInput extends AddressInput {
  label?: string;
  isDefault?: boolean;
}

export async function createAddress(userId: string, input: SaveAddressInput): Promise<Address> {
  if (input.isDefault) {
    await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  return prisma.address.create({ data: { userId, ...input } });
}

/** `userId` filters alongside the unique `id` so an address id from a different account can't be touched. */
export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  await prisma.address.delete({ where: { id: addressId, userId } });
}

export async function setDefaultAddress(userId: string, addressId: string): Promise<void> {
  await prisma.$transaction([
    prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
    prisma.address.update({ where: { id: addressId, userId }, data: { isDefault: true } }),
  ]);
}
