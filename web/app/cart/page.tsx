import Link from "next/link";
import { getCart } from "@/lib/cart";
import { price } from "@/lib/products";
import { updateCartItemAction, removeFromCartAction } from "@/lib/actions/cart";
import { BottleGlyph } from "@/app/components/bottle-glyph";
import { SubmitButton } from "@/app/components/submit-button";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const items = await getCart();
  const subtotalCents = items.reduce(
    (sum, item) => sum + (item.price_cents ?? 0) * item.quantity,
    0
  );

  return (
    <main className="wrap">
      <Link href="/" className="back">
        ← Keep browsing
      </Link>

      <h1 className="page-title">Your cart</h1>

      {items.length === 0 ? (
        <p className="empty">
          Nothing in your cart yet.{" "}
          <Link href="/" style={{ color: "var(--amber)" }}>
            Go find something you&apos;ll love
          </Link>
          .
        </p>
      ) : (
        <div className="cart">
          <ul className="cart-list">
            {items.map((item) => (
              <li className="cart-row" key={item.sku}>
                <BottleGlyph
                  sku={item.sku}
                  brand={item.brand}
                  family={item.scent_family}
                  variant="cart"
                  className="cart-glyph"
                />

                <div className="cart-info">
                  <p className="brand">{item.brand}</p>
                  <p className="cart-name">{item.product_name}</p>
                  {item.size && <p className="spec">{item.size}</p>}
                  {!item.is_active && (
                    <p className="cart-warning">No longer available. Please remove it.</p>
                  )}
                </div>

                <form action={updateCartItemAction} className="cart-qty-form">
                  <input type="hidden" name="sku" value={item.sku} />
                  <label className="sr-only" htmlFor={`qty-${item.sku}`}>
                    Quantity
                  </label>
                  <input
                    id={`qty-${item.sku}`}
                    name="quantity"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={item.quantity}
                    className="cart-qty"
                  />
                  <SubmitButton className="cart-update" pendingLabel="…">
                    Update
                  </SubmitButton>
                </form>

                <p className="cart-line-price">
                  {price((item.price_cents ?? 0) * item.quantity)}
                </p>

                <form action={removeFromCartAction}>
                  <input type="hidden" name="sku" value={item.sku} />
                  <SubmitButton className="cart-remove" pendingLabel="…">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>

          <div className="cart-summary">
            <span>Subtotal</span>
            <span className="cart-total">{price(subtotalCents)}</span>
          </div>
          <p className="cart-note">Shipping and any applicable tax are calculated at checkout.</p>

          <Link href="/checkout" className="buy" style={{ display: "inline-block" }}>
            Checkout
          </Link>
        </div>
      )}
    </main>
  );
}
