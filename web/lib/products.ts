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
  image_url: string | null;
  image_transparent_url: string | null;
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

export const PRODUCTS_PAGE_SIZE = 24;

// Shared by getProducts and getProductsCount so the two can never drift
// apart on what counts as a match.
function buildProductsWhere(filters: ProductFilters) {
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
  return conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
}

export async function getProducts(
  filters: ProductFilters = {},
  page = 1
): Promise<Product[]> {
  const where = buildProductsWhere(filters);
  const offset = (Math.max(1, page) - 1) * PRODUCTS_PAGE_SIZE;

  return sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description,
           image_url, image_transparent_url
    FROM dim_products
    WHERE ${where}
    ORDER BY brand, product_name
    LIMIT ${PRODUCTS_PAGE_SIZE} OFFSET ${offset}
  `;
}

export async function getProductsCount(filters: ProductFilters = {}): Promise<number> {
  const where = buildProductsWhere(filters);
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM dim_products WHERE ${where}
  `;
  return rows[0]?.count ?? 0;
}

/** Unfiltered grab-bag for the "nothing matched" fallback -- random rather
 *  than always the same alphabetical slice, so a dead-end search still
 *  turns into a bit of browsing instead of the same four bottles every time. */
export async function getRandomProducts(limit: number): Promise<Product[]> {
  return sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description,
           image_url, image_transparent_url
    FROM dim_products
    WHERE is_active
    ORDER BY random()
    LIMIT ${limit}
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
           scent_family, gender, top_notes, heart_notes, base_notes, description,
           image_url, image_transparent_url
    FROM dim_products
    WHERE sku = ${sku}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export type ProductSizeOption = {
  sku: string;
  size: string | null;
  price_cents: number | null;
};

/** Sibling SKUs of the same fragrance -- same brand, product name, AND
 *  concentration. Concentration is deliberately part of the match: EDT vs.
 *  EDP are genuinely different products (see etl/sku.py), not sizes of one
 *  another, so a size selector must never let someone toggle across that
 *  line believing they're just picking a bottle size. `IS NOT DISTINCT
 *  FROM` (rather than `=`) so a product with no concentration on record
 *  still matches its own siblings instead of every comparison going NULL. */
export async function getProductSizes(
  brand: string,
  productName: string,
  concentration: string | null
): Promise<ProductSizeOption[]> {
  const rows = await sql<ProductSizeOption[]>`
    SELECT sku, size, price_cents
    FROM dim_products
    WHERE is_active
      AND brand = ${brand}
      AND product_name = ${productName}
      AND concentration IS NOT DISTINCT FROM ${concentration}
  `;
  // Sorted smallest-to-largest by the leading number in size ("50ml" before
  // "100ml") rather than alphabetically, which would put "100ml" first --
  // sizes that don't parse (unexpected format) sort after ones that do,
  // in their original order, rather than throwing.
  return rows.sort((a, b) => {
    const numA = parseFloat(a.size ?? "");
    const numB = parseFloat(b.size ?? "");
    if (Number.isNaN(numA) && Number.isNaN(numB)) return 0;
    if (Number.isNaN(numA)) return 1;
    if (Number.isNaN(numB)) return -1;
    return numA - numB;
  });
}

/** Preserves the order of `skus` (most-recent-first for recently-viewed
 *  rails) rather than whatever order Postgres happens to return. */
export async function getProductsBySkus(skus: string[]): Promise<Product[]> {
  if (skus.length === 0) return [];
  const rows = await sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description,
           image_url, image_transparent_url
    FROM dim_products
    WHERE is_active AND sku = ANY(${skus})
  `;
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  return skus.map((sku) => bySku.get(sku)).filter((p): p is Product => Boolean(p));
}

/** Same family, or shares at least one top/heart/base note -- same-family
 *  matches are ranked first, notes-only overlap fills in the rest. Products
 *  with neither in common are excluded rather than padding out to a fixed
 *  count with unrelated bottles. */
export async function getSimilarProducts(
  sku: string,
  family: string | null,
  notes: string[]
): Promise<Product[]> {
  if (!family && notes.length === 0) return [];
  return sql<Product[]>`
    SELECT sku, brand, product_name, concentration, size, price_cents,
           scent_family, gender, top_notes, heart_notes, base_notes, description,
           image_url, image_transparent_url
    FROM dim_products
    WHERE is_active
      AND sku != ${sku}
      AND (
        scent_family = ${family}
        OR (top_notes && ${notes})
        OR (heart_notes && ${notes})
        OR (base_notes && ${notes})
      )
    ORDER BY (CASE WHEN scent_family = ${family} THEN 0 ELSE 1 END), random()
    LIMIT 4
  `;
}
