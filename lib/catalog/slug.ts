export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Converts a major-unit price (e.g. 6.99) to integer minor units (699). Guards against float error (6.99*100 = 698.99999...). */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}
