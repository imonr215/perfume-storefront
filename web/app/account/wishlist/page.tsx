import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getWishlist } from "@/lib/wishlist";
import { price } from "@/lib/products";
import { BottleGlyph } from "@/app/components/bottle-glyph";
import { toggleWishlistAction } from "@/lib/actions/wishlist";
import { SubmitButton } from "@/app/components/submit-button";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const session = await requireSession();
  const items = await getWishlist(session.id);

  return (
    <main className="wrap">
      <Link href="/account" className="back">
        ← Account
      </Link>
      <h1 className="page-title">Saved scents</h1>

      {items.length === 0 ? (
        <p className="empty">
          Nothing saved yet.{" "}
          <Link href="/" style={{ color: "var(--amber)" }}>
            Go find something you&apos;ll love
          </Link>
          .
        </p>
      ) : (
        <ul className="cart-list">
          {items.map((item) => (
            <li className="cart-row wishlist-row" key={item.sku}>
              <BottleGlyph
                sku={item.sku}
                brand={item.brand}
                family={item.scent_family}
                variant="wishlist"
                className="cart-glyph"
              />
              <div className="cart-row-body">
                <div className="cart-info">
                  <p className="brand">{item.brand}</p>
                  <Link href={`/scent/${item.sku}`} className="cart-name" style={{ display: "block" }}>
                    {item.product_name}
                  </Link>
                  {item.size && <p className="spec">{item.size}</p>}
                </div>
                <p className="cart-line-price">{price(item.price_cents)}</p>
                <form action={toggleWishlistAction}>
                  <input type="hidden" name="sku" value={item.sku} />
                  <input type="hidden" name="path" value="/account/wishlist" />
                  <SubmitButton className="cart-remove" pendingLabel="…">
                    Remove
                  </SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
