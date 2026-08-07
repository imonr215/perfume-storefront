import { notFound } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import { price } from "@/lib/products";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  contact_name: string;
  contact_email: string;
  shipping_address: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
  subtotal_cents: number;
  total_cents: number;
  status: string;
  created_at: string;
};

type OrderItemRow = {
  sku: string;
  product_name: string;
  brand: string | null;
  unit_price_cents: number;
  quantity: number;
};

/**
 * Keyed by the order's unguessable UUID rather than gated behind login --
 * guests have no account to log into, so the confirmation link itself is
 * the access token. See the plan notes on this tradeoff.
 */
export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const orders = await sql<OrderRow[]>`
    SELECT id, contact_name, contact_email, shipping_address, subtotal_cents, total_cents, status, created_at
    FROM store_orders
    WHERE id = ${id}
    LIMIT 1
  `;
  const order = orders[0];
  if (!order) notFound();

  const items = await sql<OrderItemRow[]>`
    SELECT sku, product_name, brand, unit_price_cents, quantity
    FROM store_order_items
    WHERE order_id = ${id}
    ORDER BY id
  `;

  const firstName = order.contact_name.split(" ")[0] || order.contact_name;

  return (
    <main className="wrap">
      <div className="order-confirmation">
        <p className="brand">
          {order.status === "paid" ? "Order confirmed" : "Order " + order.status}
        </p>
        <h1 className="page-title">Thank you, {firstName}.</h1>
        <p className="detail-blurb">
          A receipt is on its way to {order.contact_email}. Keep this link — it&apos;s your order
          confirmation.
        </p>

        <section className="order-summary order-confirmation-summary">
          <h2 className="section-label">Order #{order.id.slice(0, 8)}</h2>
          <ul>
            {items.map((item) => (
              <li key={item.sku} className="order-summary-row">
                <span>
                  {item.brand} {item.product_name} × {item.quantity}
                </span>
                <span>{price(item.unit_price_cents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="cart-summary">
            <span>Total</span>
            <span className="cart-total">{price(order.total_cents)}</span>
          </div>
        </section>

        {order.shipping_address && (
          <section className="order-confirmation-address">
            <h2 className="section-label">Shipping to</h2>
            <p className="spec">
              {order.shipping_address.addressLine1}
              {order.shipping_address.addressLine2 ? `, ${order.shipping_address.addressLine2}` : ""}
              <br />
              {order.shipping_address.city}, {order.shipping_address.state}{" "}
              {order.shipping_address.postalCode}
              <br />
              {order.shipping_address.country}
            </p>
          </section>
        )}

        <Link href="/" className="back order-confirmation-continue">
          ← Continue shopping
        </Link>
      </div>
    </main>
  );
}
