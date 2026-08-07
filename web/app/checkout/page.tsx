import { redirect } from "next/navigation";
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { getSession } from "@/lib/auth";
import { price } from "@/lib/products";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

type SavedAddress = Partial<{
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}>;

export default async function CheckoutPage() {
  const [items, session] = await Promise.all([getCart(), getSession()]);
  if (items.length === 0) redirect("/cart");

  const subtotalCents = items.reduce(
    (sum, item) => sum + (item.price_cents ?? 0) * item.quantity,
    0
  );
  const address = (session?.defaultShippingAddress ?? {}) as SavedAddress;

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
            name: session?.name ?? "",
            email: session?.email ?? "",
            phone: session?.phone ?? "",
            addressLine1: address.addressLine1 ?? "",
            addressLine2: address.addressLine2 ?? "",
            city: address.city ?? "",
            state: address.state ?? "",
            postalCode: address.postalCode ?? "",
            country: address.country ?? "US",
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
          <p className="cart-note">Card details go straight to Square — this site never sees them.</p>
        </aside>
      </div>
    </main>
  );
}
