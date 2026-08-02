import { sql } from "@/lib/db";

export type Product = {
  sku: string;
  brand: string;
  product_name: string;
  concentration: string | null;
  size: string | null;
  price_cents: number | null;
  scent_family: string | null;
  gender: string | null;
  top_notes: string[] | null;
  heart_notes: string[] | null;
  base_notes: string[] | null;
  description: string | null;
};

/**
 * Each scent family gets its own hue, used for the pyramid rail on the cards.
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

export async function getProducts(family?: string): Promise<Product[]> {
  if (family) {
    return sql<Product[]>`
      SELECT sku, brand, product_name, concentration, size, price_cents,
             scent_family, gender, top_notes, heart_notes, base_notes, description
      FROM dim_products
      WHERE is_active AND scent_family = ${family}
      ORDER BY brand, product_name
    `;
  }
  return sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description
    FROM dim_products
    WHERE is_active
    ORDER BY brand, product_name
  `;
}

export async function getFamilies(): Promise<string[]> {
  const rows = await sql<{ scent_family: string }[]>`
    SELECT DISTINCT scent_family
    FROM dim_products
    WHERE is_active AND scent_family IS NOT NULL
    ORDER BY scent_family
  `;
  return rows.map((r) => r.scent_family);
}

export async function getProduct(sku: string): Promise<Product | null> {
  const rows = await sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description
    FROM dim_products
    WHERE sku = ${sku}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
