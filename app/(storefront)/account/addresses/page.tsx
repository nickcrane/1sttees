import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/customer-auth/config";
import { addAddressAction, deleteAddressAction, setDefaultAddressAction } from "@/lib/customer/actions";
import { listAddresses } from "@/lib/customer/addresses";

export const metadata: Metadata = { title: "Saved addresses" };

const SHIP_TO_COUNTRIES = [
  { code: "GB", label: "United Kingdom" },
  { code: "IE", label: "Ireland" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "NL", label: "Netherlands" },
];

export default async function AddressesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/account");

  const addresses = await listAddresses(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Saved addresses</h1>
        <Link href="/account" className="text-sm underline">
          Back to account
        </Link>
      </div>

      {addresses.length > 0 && (
        <ul className="flex flex-col gap-3">
          {addresses.map((address) => (
            <li key={address.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{address.label || address.name}</p>
                {address.isDefault && <Badge variant="secondary">Default</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {address.name}
                <br />
                {address.line1}
                {address.line2 && (
                  <>
                    <br />
                    {address.line2}
                  </>
                )}
                <br />
                {address.city}, {address.postcode}
                <br />
                {address.country}
              </p>
              <div className="flex gap-2">
                {!address.isDefault && (
                  <form action={setDefaultAddressAction}>
                    <input type="hidden" name="addressId" value={address.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Set as default
                    </Button>
                  </form>
                )}
                <form action={deleteAddressAction}>
                  <input type="hidden" name="addressId" value={address.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={addAddressAction} className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <h2 className="font-heading text-sm font-semibold">Add a new address</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label">Label (optional)</Label>
          <Input id="label" name="label" placeholder="Home" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line1">Address line 1</Label>
          <Input id="line1" name="line1" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line2">Address line 2 (optional)</Label>
          <Input id="line2" name="line2" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">Town / City</Label>
            <Input id="city" name="city" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="postcode">Postcode</Label>
            <Input id="postcode" name="postcode" required />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">Country</Label>
          <select
            id="country"
            name="country"
            defaultValue="GB"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {SHIP_TO_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isDefault" className="size-4" />
          Set as default address
        </label>
        <Button type="submit" className="self-start">
          Save address
        </Button>
      </form>
    </div>
  );
}
