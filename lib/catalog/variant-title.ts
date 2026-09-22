export function variantTitle(skuAttrs: string): string {
  // sku_attr is `;`-separated property groups, each optionally carrying a
  // human-readable label after a `#` (confirmed live in both shapes: golf
  // tee SKUs are a single group, "14:200000led#83mm"; the test-account
  // T-shirt SKUs have several, e.g.
  // "5:4182;14:1254#tianlan;200007763:201441035" -- only the middle group
  // has a label). Pull the label out of every group that has one and join
  // them; a group with no label (a raw property-id pair, like the third
  // one above) contributes nothing rather than polluting the title.
  if (!skuAttrs) return "Default";
  const labels = skuAttrs
    .split(";")
    .map((group) => group.split("#")[1])
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(" / ") : skuAttrs;
}
