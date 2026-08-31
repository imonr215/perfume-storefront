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
  Aromatic: "#7d9469",
  Fougère: "#5f8a72",
  Floral: "#c98195",
  Woody: "#8a5a34",
  "Amber/Oriental": "#7a4a63",
  Gourmand: "#a9663c",
  Leather: "#6b4630",
};

export function hueFor(family: string | null): string {
  return (family && FAMILY_HUE[family]) || "#8a5a34";
}

/** One line per family, for the hero banner shown when browsing a specific
 *  one (see app/components/family-hero.tsx) -- kept short and concrete,
 *  matching the voice of the product descriptions rather than reaching for
 *  flowery copy. */
export const FAMILY_BLURB: Record<string, string> = {
  Citrus: "Bright and zesty, the wake-up call of the fragrance world.",
  "Fresh/Aquatic": "Clean and airy, like sea spray and cold water.",
  Aromatic: "Herbal and sharp, built around lavender and sage.",
  Fougère: "The classic barbershop accord: lavender, oakmoss, and clean musk.",
  Floral: "Soft petals and powder, the most crowded family for good reason.",
  Woody: "Warm sandalwood and cedar, grounded and easy to wear every day.",
  "Amber/Oriental": "Rich resins and spice, warm and dense and unmistakable.",
  Gourmand: "Vanilla, sugar, and dessert-adjacent sweetness.",
  Leather: "Smoky and dry, worn-in and confident.",
};

export function price(cents: number | null): string {
  if (cents == null) return "N/A";
  return `$${(cents / 100).toFixed(0)}`;
}
