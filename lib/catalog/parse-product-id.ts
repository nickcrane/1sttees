/**
 * Accepts either a bare AliExpress product id ("1005006525360508") or a
 * product page URL in any of the shapes seen in this project so far
 * (protocol-relative from search results, with a trailing query string,
 * with or without a scheme) and returns just the numeric id.
 */
export function parseAeProductId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/\/item\/(\d+)\.html/);
  return match ? match[1] : null;
}
