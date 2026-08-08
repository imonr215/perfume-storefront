import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, getSimilarProducts, hueFor, price } from "@/lib/products";
import { addToCartAction } from "@/lib/actions/cart";
import { toggleWishlistAction } from "@/lib/actions/wishlist";
import { getSession } from "@/lib/auth";
import { isWishlisted } from "@/lib/wishlist";
import { BottleGlyph } from "@/app/components/bottle-glyph";
import { NoteIcon } from "@/app/components/note-icon";
import { ProductCard } from "@/app/components/product-card";
import { SubmitButton } from "@/app/components/submit-button";
import { RecordView } from "./record-view";

export const dynamic = "force-dynamic";

const TIERS = [
  { key: "top_notes", label: "Top", hint: "the first minute" },
  { key: "heart_notes", label: "Heart", hint: "the middle hours" },
  { key: "base_notes", label: "Base", hint: "what stays" },
] as const;

export default async function ScentPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const p = await getProduct(decodeURIComponent(sku));
  if (!p) notFound();

  const hue = hueFor(p.scent_family);

  const [session, similar] = await Promise.all([
    getSession(),
    getSimilarProducts(p.sku, p.scent_family, [
      ...(p.top_notes ?? []),
      ...(p.heart_notes ?? []),
      ...(p.base_notes ?? []),
    ]),
  ]);
  const wishlisted = session ? await isWishlisted(session.id, p.sku) : false;

  return (
    <main className="wrap">
      <RecordView sku={p.sku} />

      <Link href="/" className="back">
        ← Back to the shelf
      </Link>

      <div className="detail">
        <div>
          <BottleGlyph
            sku={p.sku}
            brand={p.brand}
            family={p.scent_family}
            variant="detail"
            className="detail-glyph"
          />

          <p className="brand">{p.brand}</p>
          <h1>{p.product_name}</h1>
          <p className="spec">
            {[p.concentration, p.size, p.gender].filter(Boolean).join(" · ")}
          </p>

          {p.description && <p className="detail-blurb">{p.description}</p>}

          <p className="detail-price">{price(p.price_cents)}</p>

          {/* Card details never touch our server: checkout tokenizes with
              Square's Web Payments SDK client-side. */}
          <form action={addToCartAction} className="add-to-bag">
            <input type="hidden" name="sku" value={p.sku} />
            <label className="sr-only" htmlFor="quantity">
              Quantity
            </label>
            <select id="quantity" name="quantity" defaultValue="1" className="add-to-bag-qty">
              {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button className="buy" type="submit">
              Add to cart
            </button>
          </form>

          {session ? (
            <form action={toggleWishlistAction} className="wishlist-form">
              <input type="hidden" name="sku" value={p.sku} />
              <input type="hidden" name="path" value={`/scent/${p.sku}`} />
              <SubmitButton className="wishlist-toggle" pendingLabel="…">
                {wishlisted ? "♥ Saved" : "♡ Save for later"}
              </SubmitButton>
            </form>
          ) : (
            <Link href="/login" className="wishlist-toggle wishlist-toggle-link">
              ♡ Save for later
            </Link>
          )}
        </div>

        <section className="pyramid">
          <h2>How it wears</h2>
          {TIERS.map(({ key, label, hint }) => {
            const notes = p[key] ?? [];
            if (notes.length === 0) return null;
            return (
              <div className="tier" key={key}>
                <div className="tier-label">
                  {label}
                  <br />
                  <span style={{ opacity: 0.7, letterSpacing: 0 }}>{hint}</span>
                </div>
                <div className="notes">
                  {notes.map((n) => (
                    <span className="note" key={n} style={{ borderColor: hue }}>
                      <NoteIcon note={n} className="note-icon" style={{ color: hue }} />
                      <span className="note-label">{n}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {similar.length > 0 && (
        <section className="similar-section">
          <h2 className="section-label">You might also like</h2>
          <div className="grid">
            {similar.map((sp) => (
              <ProductCard key={sp.sku} product={sp} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
