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

  // Payment happens live on the kiosk's Flex device (Remote Pay Cloud), not
  // through an online card form -- see root CLAUDE.md and the migration
  // plan. These three come from the server; the access token specifically
  // is a real credential the SDK needs client-side to open its own
  // WebSocket connection, so it's handed down as a prop rather than baked
  // into a NEXT_PUBLIC_* var, but it's still visible to the browser either
  // way -- that's inherent to how this SDK has to work, not an oversight.
  const merchantId = process.env.CLOVER_MERCHANT_ID ?? "";
  const deviceId = process.env.CLOVER_KIOSK_DEVICE_ID ?? "";
  const accessToken = process.env.CLOVER_API_TOKEN ?? "";
  const remoteApplicationId = process.env.CLOVER_REMOTE_APPLICATION_ID ?? "";
  const paymentConfigured = Boolean(merchantId && deviceId && accessToken && remoteApplicationId);

  return (
    <main className="wrap">
      <Link href="/cart" className="back">
        ← Back to your cart
      </Link>
      <h1 className="page-title">Checkout</h1>

      <div className="checkout-grid">
        <CheckoutForm
          offerAccountCreation={!session}
          paymentConfigured={paymentConfigured}
          clover={{ merchantId, deviceId, accessToken, remoteApplicationId }}
          totalCents={subtotalCents}
          defaults={{
            name: defaultAddress?.recipient_name ?? session?.name ?? "",
            email: session?.email ?? "",
            phone: defaultAddress?.phone ?? session?.phone ?? "",
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
          <p className="cart-note">
            Pickup only for now -- you&apos;ll pay in person on the terminal at our
            kiosk. Card details never touch this site.
          </p>
        </aside>
      </div>
    </main>
  );
}
