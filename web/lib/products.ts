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
  size?: string;
  brand?: string;
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
  if (filters.size) conditions.push(sql`size = ${filters.size}`);
  if (filters.brand) conditions.push(sql`brand = ${filters.brand}`);
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

export type ProductGroup = {
  product: Product;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sizes: ProductSizeOption[];
  concentrations: ProductConcentrationOption[];
};

/** One tile per (brand, product name) rather than one per SKU/size/
 *  concentration row -- e.g. one "Dior Sauvage" tile covering EDT and EDP
 *  alike, each with its own sizes, rather than a separate tile per
 *  concentration. Concentration used to be part of the group key here (see
 *  git history) on the reasoning that EDT/EDP are genuinely different
 *  products, not sizes of one another (etl/sku.py) -- still true
 *  underneath (still distinct SKUs/prices, still a real ConcentrationSelector
 *  choice, never silently blurred into "the same product"), but relaxed at
 *  the grouping/display level per request: concentration is now a second
 *  selectable dimension on the tile, same treatment as size, not a group
 *  boundary. `DISTINCT ON` picks the overall cheapest variant (any size,
 *  any concentration) as the representative `Product`, which is why the
 *  matching `ORDER BY` ends with `price_cents ASC` -- Postgres requires
 *  `DISTINCT ON` expressions to be the leading `ORDER BY` expressions, so
 *  the group key comes first and the tiebreak that actually picks the
 *  winning row comes last. The min/max window aggregates ride along on
 *  every row of a group before `DISTINCT ON` collapses it down to one, so
 *  they survive on the winning row -- same "from $X" data the size/
 *  concentration selectors need, sourced in the same query rather than a
 *  second pass. */
export async function getProductGroups(
  filters: ProductFilters = {},
  page = 1
): Promise<ProductGroup[]> {
  const where = buildProductsWhere(filters);
  const offset = (Math.max(1, page) - 1) * PRODUCTS_PAGE_SIZE;

  // Grouped by lower(trim(...)) rather than the raw columns -- confirmed
  // live this catalog has genuine casing slips from data entry ("J'adore"
  // vs "J'Adore", "Bleu de Chanel" vs "Bleu De Chanel") that split one
  // product into two tiles under a case-sensitive grouping key. The raw
  // brand/product_name are still selected and displayed as-is (whichever
  // row wins the price tiebreak), just not used as the grouping key
  // itself -- this can't fix which casing displays, only that a future
  // slip like it can't split a tile again.
  const rows = await sql<
    (Product & { group_min_price: number | null; group_max_price: number | null })[]
  >`
    WITH grouped AS (
      SELECT DISTINCT ON (lower(trim(brand)), lower(trim(product_name)))
        sku, brand, product_name, concentration, size, price_cents,
        scent_family, gender, top_notes, heart_notes, base_notes, description,
        image_url, image_transparent_url,
        MIN(price_cents) OVER (PARTITION BY lower(trim(brand)), lower(trim(product_name))) AS group_min_price,
        MAX(price_cents) OVER (PARTITION BY lower(trim(brand)), lower(trim(product_name))) AS group_max_price
      FROM dim_products
      WHERE ${where}
      ORDER BY lower(trim(brand)), lower(trim(product_name)), price_cents ASC
    )
    SELECT * FROM grouped
    ORDER BY lower(trim(brand)), lower(trim(product_name))
    LIMIT ${PRODUCTS_PAGE_SIZE} OFFSET ${offset}
  `;

  // Sibling sizes (within the representative row's own concentration) and
  // sibling concentrations for each of this page's (<=24) groups -- one
  // call per group to each of getProductSizes()/getProductConcentrations(),
  // run concurrently. Not a batched array_agg query: this page already
  // fires several concurrent queries per load (see lib/db.ts's pool-sizing
  // comment), and reusing the existing, already-correct functions beats a
  // second, fragile parallel-array aggregation of the same data.
  const [sizesByGroup, concentrationsByGroup] = await Promise.all([
    Promise.all(rows.map((r) => getProductSizes(r.brand, r.product_name, r.concentration))),
    Promise.all(rows.map((r) => getProductConcentrations(r.brand, r.product_name))),
  ]);

  return rows.map((r, i) => ({
    product: {
      sku: r.sku,
      brand: r.brand,
      product_name: r.product_name,
      concentration: r.concentration,
      size: r.size,
      price_cents: r.price_cents,
      scent_family: r.scent_family,
      gender: r.gender,
      top_notes: r.top_notes,
      heart_notes: r.heart_notes,
      base_notes: r.base_notes,
      description: r.description,
      image_url: r.image_url,
      image_transparent_url: r.image_transparent_url,
    },
    minPriceCents: r.group_min_price,
    maxPriceCents: r.group_max_price,
    sizes: sizesByGroup[i],
    concentrations: concentrationsByGroup[i],
  }));
}

export async function getProductGroupsCount(filters: ProductFilters = {}): Promise<number> {
  const where = buildProductsWhere(filters);
  // lower(trim(...)) here too -- must match getProductGroups()'s grouping
  // key exactly, or this count and the actual number of tiles rendered
  // (and therefore pagination) would silently drift apart.
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (
      SELECT DISTINCT lower(trim(brand)), lower(trim(product_name))
      FROM dim_products
      WHERE ${where}
    ) t
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

export async function getBrands(): Promise<string[]> {
  const rows = await sql<{ brand: string }[]>`
    SELECT DISTINCT brand
    FROM dim_products
    WHERE is_active
    ORDER BY brand
  `;
  return rows.map((r) => r.brand);
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

/** Common sizes on record, for the top-level size filter (not to be
 *  confused with getProductSizes, which is scoped to one fragrance's own
 *  siblings). The catalog has 20+ distinct sizes, but it's a steep drop-off
 *  -- a handful (100ml, 50ml, 90ml...) cover the great majority of
 *  products, then a long tail of one-off odd sizes (4ml, 7.5ml, a handful
 *  of 1-count sizes from gift sets/travel minis). A dropdown listing all of
 *  them is exactly the "too many options" a kiosk/tablet filter shouldn't
 *  have, so this only returns sizes with a real number of products behind
 *  them (currently a size needs 10+ products on record to show up here --
 *  chosen from the actual distribution: it's the natural break right after
 *  the common sizes and before the tail starts, not an arbitrary round
 *  number). Sorted by the leading number ("50ml" before "100ml") rather
 *  than alphabetically -- same reasoning and NaN-safety as
 *  getProductSizes' sort, just applied to the whole catalog's distinct
 *  values instead of one product's siblings. */
const MIN_PRODUCTS_FOR_SIZE_FILTER = 10;

export async function getSizes(): Promise<string[]> {
  const rows = await sql<{ size: string }[]>`
    SELECT size
    FROM dim_products
    WHERE is_active AND size IS NOT NULL
    GROUP BY size
    HAVING count(*) >= ${MIN_PRODUCTS_FOR_SIZE_FILTER}
  `;
  return rows
    .map((r) => r.size)
    .sort((a, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (Number.isNaN(numA) && Number.isNaN(numB)) return 0;
      if (Number.isNaN(numA)) return 1;
      if (Number.isNaN(numB)) return -1;
      return numA - numB;
    });
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
  // lower(trim(...)) on both sides -- must match getProductGroups()'s
  // grouping key, or a casing/whitespace slip on one sibling row would
  // make it invisible to this selector even after the tile itself
  // correctly grouped the rest.
  const rows = await sql<ProductSizeOption[]>`
    SELECT sku, size, price_cents
    FROM dim_products
    WHERE is_active
      AND lower(trim(brand)) = lower(trim(${brand}))
      AND lower(trim(product_name)) = lower(trim(${productName}))
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

export type ProductConcentrationOption = {
  sku: string;
  concentration: string | null;
  price_cents: number | null;
};

/** Sibling concentrations of the same fragrance -- same brand and product
 *  name, any concentration, any size. Each concentration is represented by
 *  its own cheapest SKU (`DISTINCT ON` + matching `price_cents ASC` order,
 *  same pattern as getProductGroups) so this links to *a* real, addressable
 *  product for that concentration -- picking "EDP" here and picking a
 *  specific size are two separate steps (this selector, then the size
 *  selector on whichever concentration's page you land on), not one
 *  combined jump, keeping this a plain link like SizeSelector rather than
 *  needing client-side state to track two dimensions at once. */
export async function getProductConcentrations(
  brand: string,
  productName: string
): Promise<ProductConcentrationOption[]> {
  // Same lower(trim(...)) matching as getProductSizes(), same reason.
  return sql<ProductConcentrationOption[]>`
    SELECT DISTINCT ON (concentration) sku, concentration, price_cents
    FROM dim_products
    WHERE is_active
      AND lower(trim(brand)) = lower(trim(${brand}))
      AND lower(trim(product_name)) = lower(trim(${productName}))
    ORDER BY concentration, price_cents ASC
  `;
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
