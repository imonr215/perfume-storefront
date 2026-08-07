/**
 * Pure display helpers -- deliberately kept free of any `@/lib/db` import.
 * lib/products.ts (which does import the DB client) re-exports these for
 * backwards compatibility, but anything that needs to run in a Client
 * Component (like the bottle glyph / quick view) must import from here
 * directly, or webpack ends up trying to bundle `postgres` for the browser.
 */

/**
 * Each scent family gets its own hue, used for the pyramid rail on the cards
 * and the generated bottle glyphs (see app/components/bottle-glyph.tsx).
 * Colour carries information here: fresh families read green, ambers read
 * plum, so the shelf is scannable by character before you read a label.
 */
export const FAMILY_HUE: Record<string, string> = {
  Citrus: "#d0a02a",
  "Fresh/Aquatic": "#4f8ea0",
  Green: "#6f7f5c",
  Aromatic: "#7d9469",
  Fougère: "#5f8a72",
  Floral: "#c98195",
  Chypre: "#8a7340",
  Woody: "#8a5a34",
  "Amber/Oriental": "#7a4a63",
  Gourmand: "#a9663c",
  Leather: "#6b4630",
  Spicy: "#b05a34",
};

export function hueFor(family: string | null): string {
  return (family && FAMILY_HUE[family]) || "#8a5a34";
}

export function price(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(0)}`;
}
