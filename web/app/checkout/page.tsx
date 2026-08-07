import { redirect } from "next/navigation";
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { getSession } from "@/lib/auth";
import { getDefaultAddress } from "@/lib/addresses";
import { price } from "@/lib/products";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const [items, session] = await Promise.all([getCart(), getSession()]);
  if (items.length === 0) redirect("/cart");

  const subtotalCents = items.reduce(
    (sum, item) => sum + (item.price_cents ?? 0) * item.quantity,
    0
  );
  const defaultAddress = session ? await getDefaultAddress(session.id) : null;

  return (
    <main className="wrap">
      <Link href="/cart" className="back">
        ← Back to your bag
      </Link>
      <h1 className="page-title">Checkout</h1>

      <div className="checkout-grid">
        <CheckoutForm
          offerAccountCreation={!session}
          defaults={{
            name: defaultAddress?.recipient_name ?? session?.name ?? "",
            email: session?.email ?? "",
            phone: defaultAddress?.phone ?? session?.phone ?? "",
            addressLine1: defaultAddress?.address_line1 ?? "",
            addressLine2: defaultAddress?.address_line2 ?? "",
            city: defaultAddress?.city ?? "",
            state: defaultAddress?.state ?? "",
            postalCode: defaultAddress?.postal_code ?? "",
            country: defaultAddress?.country ?? "US",
          }}
        />

        <aside className="order-summary">
          <h2 className="section-label">Order summary</h2>
          <ul>
            {items.map((item) => (
              <li key={item.sku} className="order-summary-row">
                <span>
                  {item.brand} {item.product_name} × {item.quantity}
                </span>
                <span>{price((item.price_cents ?? 0) * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="cart-summary">
            <span>Subtotal</span>
            <span className="cart-total">{price(subtotalCents)}</span>
          </div>
          <p className="cart-note">Card details go straight to Square and never touch this site.</p>
          {session && (
            <p className="cart-note">
              {defaultAddress ? "Prefilled from your default address. " : ""}
              <Link href="/account/addresses" style={{ color: "var(--amber)" }}>
                Manage saved addresses
              </Link>
              .
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
