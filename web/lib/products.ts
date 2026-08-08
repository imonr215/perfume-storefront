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

export type ProductFilters = {
  family?: string;
  gender?: string;
  concentration?: string;
  /** Free-text search: matches brand, product name, description, or any
   *  top/heart/base note. */
  q?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
};

export async function getProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const conditions = [sql`is_active`];

  if (filters.family) conditions.push(sql`scent_family = ${filters.family}`);
  if (filters.gender) conditions.push(sql`gender = ${filters.gender}`);
  if (filters.concentration) conditions.push(sql`concentration = ${filters.concentration}`);
  if (filters.priceMinCents != null) conditions.push(sql`price_cents >= ${filters.priceMinCents}`);
  if (filters.priceMaxCents != null) conditions.push(sql`price_cents <= ${filters.priceMaxCents}`);

  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    conditions.push(sql`(
      brand ILIKE ${like}
      OR product_name ILIKE ${like}
      OR description ILIKE ${like}
      OR EXISTS (
        SELECT 1 FROM unnest(
          COALESCE(top_notes, '{}') || COALESCE(heart_notes, '{}') || COALESCE(base_notes, '{}')
        ) AS note
        WHERE note ILIKE ${like}
      )
    )`);
  }

  // Fragments compose: each condition is its own sql`` template, folded
  // together into a single "a AND b AND c" fragment before being dropped
  // into the WHERE clause below.
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  return sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description
    FROM dim_products
    WHERE ${where}
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

export async function getGenders(): Promise<string[]> {
  const rows = await sql<{ gender: string }[]>`
    SELECT DISTINCT gender
    FROM dim_products
    WHERE is_active AND gender IS NOT NULL
    ORDER BY gender
  `;
  return rows.map((r) => r.gender);
}

export async function getConcentrations(): Promise<string[]> {
  const rows = await sql<{ concentration: string }[]>`
    SELECT DISTINCT concentration
    FROM dim_products
    WHERE is_active AND concentration IS NOT NULL
    ORDER BY concentration
  `;
  return rows.map((r) => r.concentration);
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
