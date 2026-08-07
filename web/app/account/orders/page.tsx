import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { price } from "@/lib/products";

export const dynamic = "force-dynamic";

type OrderRow = { id: string; total_cents: number; status: string; created_at: string };

export default async function OrderHistoryPage() {
  const session = await requireSession();

  const orders = await sql<OrderRow[]>`
    SELECT id, total_cents, status, created_at
    FROM store_orders
    WHERE customer_id = ${session.id}
    ORDER BY created_at DESC
  `;

  return (
    <main className="wrap">
      <Link href="/account" className="back">
        ← Account
      </Link>
      <h1 className="page-title">Order history</h1>

      {orders.length === 0 ? (
        <p className="empty">
          No orders yet.{" "}
          <Link href="/" style={{ color: "var(--amber)" }}>
            Go find something you&apos;ll love
          </Link>
          .
        </p>
      ) : (
        <ul className="order-history">
          {orders.map((order) => (
            <li key={order.id} className="order-history-row">
              <Link href={`/order/${order.id}`}>
                <span>Order #{order.id.slice(0, 8)}</span>
                <span className="spec">{new Date(order.created_at).toLocaleDateString()}</span>
                <span>{price(order.total_cents)}</span>
                <span className="spec">{order.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
