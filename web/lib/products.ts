import { sql } from "@/lib/db";

export { FAMILY_HUE, hueFor, price } from "@/lib/format";

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
