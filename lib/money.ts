/** Formats integer minor units (pence) as a localized currency string, e.g. 1999 -> "£19.99". */
export function formatMinor(amountMinor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amountMinor / 100);
}
