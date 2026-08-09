import { sql } from "@/lib/db";
import type { Product } from "@/lib/products";

export type WishlistItem = Product & { added_at: string };

export async function isWishlisted(customerId: string, sku: string): Promise<boolean> {
  const rows = await sql<{ sku: string }[]>`
    SELECT sku FROM store_wishlist_items WHERE customer_id = ${customerId} AND sku = ${sku}
  `;
  return rows.length > 0;
}

export async function getWishlist(customerId: string): Promise<WishlistItem[]> {
  return sql<WishlistItem[]>`
    SELECT p.sku, p.brand, p.product_name, p.concentration, p.size, p.price_cents,
           p.scent_family, p.gender, p.top_notes, p.heart_notes, p.base_notes, p.description,
           p.image_url, p.image_transparent_url,
           w.added_at
    FROM store_wishlist_items w
    JOIN dim_products p ON p.sku = w.sku
    WHERE w.customer_id = ${customerId}
    ORDER BY w.added_at DESC
  `;
}

/** Pure toggle keyed off current DB state -- add if absent, remove if
 *  present -- so a single plain-HTML form/button always does the right
 *  thing regardless of what the client last rendered. Returns the new
 *  state (true = now saved). */
export async function toggleWishlist(customerId: string, sku: string): Promise<boolean> {
  const deleted = await sql<{ sku: string }[]>`
    DELETE FROM store_wishlist_items
    WHERE customer_id = ${customerId} AND sku = ${sku}
    RETURNING sku
  `;
  if (deleted.length > 0) return false;

  await sql`
    INSERT INTO store_wishlist_items (customer_id, sku)
    VALUES (${customerId}, ${sku})
    ON CONFLICT DO NOTHING
  `;
  return true;
}
