import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * Cart identity, split into a read path and a write path.
 *
 * Next.js forbids setting cookies during Server Component rendering (only
 * Server Actions / Route Handlers may do that) -- so `readCartId` is safe to
 * call from a plain page (cart display, header count) and never creates
 * anything, while `ensureCartId` (which may set the cart_id cookie) must
 * only be called from a Server Action.
 */
const CART_COOKIE = "cart_id";
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export type CartItem = {
  sku: string;
  quantity: number;
  brand: string;
  product_name: string;
  size: string | null;
  price_cents: number | null;
  is_active: boolean;
  scent_family: string | null;
};

async function setCartCookie(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, cartId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  });
}

/** Read-only cookie peek, for callers (like the login action) that need the
 *  guest cart id before it gets replaced by the customer's cart. */
export async function peekCartCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value ?? null;
}

async function getOrCreateCustomerCartId(customerId: string): Promise<string> {
  // ON CONFLICT ... DO UPDATE (a no-op self-assignment) rather than DO
  // NOTHING, purely so RETURNING still gives back the existing row's id.
  const rows = await sql<{ id: string }[]>`
    INSERT INTO store_carts (customer_id) VALUES (${customerId})
    ON CONFLICT (customer_id) DO UPDATE SET updated_at = store_carts.updated_at
    RETURNING id
  `;
  return rows[0].id;
}

/** Safe from Server Components: never writes a cookie, never inserts a row. */
export async function readCartId(): Promise<string | null> {
  const session = await getSession();

  if (session) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM store_carts WHERE customer_id = ${session.id}
    `;
    return rows[0]?.id ?? null;
  }

  const existing = await peekCartCookie();
  if (!existing) return null;
  const rows = await sql<{ id: string }[]>`SELECT id FROM store_carts WHERE id = ${existing}`;
  return rows[0]?.id ?? null;
}

/** Server Actions / Route Handlers only -- may create a cart and set a cookie. */
export async function ensureCartId(): Promise<string> {
  const session = await getSession();
  if (session) {
    const cartId = await getOrCreateCustomerCartId(session.id);
    await setCartCookie(cartId);
    return cartId;
  }

  const existing = await peekCartCookie();
  if (existing) {
    const rows = await sql<{ id: string }[]>`SELECT id FROM store_carts WHERE id = ${existing}`;
    if (rows[0]) return rows[0].id;
  }

  const created = await sql<{ id: string }[]>`INSERT INTO store_carts DEFAULT VALUES RETURNING id`;
  await setCartCookie(created[0].id);
  return created[0].id;
}

export async function getCart(): Promise<CartItem[]> {
  const cartId = await readCartId();
  if (!cartId) return [];
  return sql<CartItem[]>`
    SELECT ci.sku, ci.quantity, p.brand, p.product_name, p.size, p.price_cents, p.is_active, p.scent_family
    FROM store_cart_items ci
    JOIN dim_products p ON p.sku = ci.sku
    WHERE ci.cart_id = ${cartId}
    ORDER BY ci.added_at
  `;
}

export async function cartCount(): Promise<number> {
  const cartId = await readCartId();
  if (!cartId) return 0;
  const rows = await sql<{ total: string | null }[]>`
    SELECT SUM(quantity) AS total FROM store_cart_items WHERE cart_id = ${cartId}
  `;
  return Number(rows[0]?.total ?? 0);
}

export async function addToCart(sku: string, quantity: number): Promise<void> {
  if (quantity < 1) return;
  const product = await sql<{ sku: string }[]>`
    SELECT sku FROM dim_products WHERE sku = ${sku} AND is_active LIMIT 1
  `;
  if (!product[0]) throw new Error("That product isn't available.");

  const cartId = await ensureCartId();
  await sql`
    INSERT INTO store_cart_items (cart_id, sku, quantity)
    VALUES (${cartId}, ${sku}, ${quantity})
    ON CONFLICT (cart_id, sku)
    DO UPDATE SET quantity = store_cart_items.quantity + EXCLUDED.quantity
  `;
}

export async function updateCartItemQuantity(sku: string, quantity: number): Promise<void> {
  const cartId = await readCartId();
  if (!cartId) return;
  if (quantity < 1) {
    await sql`DELETE FROM store_cart_items WHERE cart_id = ${cartId} AND sku = ${sku}`;
    return;
  }
  await sql`
    UPDATE store_cart_items SET quantity = ${quantity}
    WHERE cart_id = ${cartId} AND sku = ${sku}
  `;
}

export async function removeFromCart(sku: string): Promise<void> {
  const cartId = await readCartId();
  if (!cartId) return;
  await sql`DELETE FROM store_cart_items WHERE cart_id = ${cartId} AND sku = ${sku}`;
}

export async function clearCart(cartId: string): Promise<void> {
  await sql`DELETE FROM store_cart_items WHERE cart_id = ${cartId}`;
}

/**
 * Called right after a successful login. Folds whatever the guest was
 * carrying into the account's persistent cart (summing quantities for any
 * SKU in both), then repoints the cookie at the customer's cart.
 */
export async function mergeGuestCartIntoCustomer(
  customerId: string,
  guestCartId: string | null
): Promise<void> {
  const customerCartId = await getOrCreateCustomerCartId(customerId);

  if (guestCartId && guestCartId !== customerCartId) {
    await sql`
      INSERT INTO store_cart_items (cart_id, sku, quantity)
      SELECT ${customerCartId}, sku, quantity FROM store_cart_items WHERE cart_id = ${guestCartId}
      ON CONFLICT (cart_id, sku)
      DO UPDATE SET quantity = store_cart_items.quantity + EXCLUDED.quantity
    `;
    await sql`DELETE FROM store_carts WHERE id = ${guestCartId}`;
  }

  await setCartCookie(customerCartId);
}
