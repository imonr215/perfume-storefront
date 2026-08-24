import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, getProductSizes, getSimilarProducts, hueFor, price } from "@/lib/products";
import { toggleWishlistAction } from "@/lib/actions/wishlist";
import { getSession } from "@/lib/auth";
import { isWishlisted } from "@/lib/wishlist";
import { AddToCartForm } from "@/app/components/add-to-cart-form";
import { ProductPhoto } from "@/app/components/product-photo";
import { NoteIcon } from "@/app/components/note-icon";
import { ProductCard } from "@/app/components/product-card";
import { SizeSelector } from "@/app/components/size-selector";
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

  const [session, similar, sizes] = await Promise.all([
    getSession(),
    getSimilarProducts(p.sku, p.scent_family, [
      ...(p.top_notes ?? []),
      ...(p.heart_notes ?? []),
      ...(p.base_notes ?? []),
    ]),
    getProductSizes(p.brand, p.product_name, p.concentration),
  ]);
  const wishlisted = session ? await isWishlisted(session.id, p.sku) : false;

  return (
    <main className="wrap">
      <RecordView sku={p.sku} />

      <Link href="/" className="back">
        ← Back to the shelf
      </Link>

      {/* Everything above "You might also like" sits on one card tinted with
          the product's own scent family color (same hue map as the family
          hero on the home grid) -- once you've filtered to a family and
          clicked into a product, this is what still tells you which family
          you're looking at. */}
      <div className="detail-family-wrap" style={{ ["--family-hue" as string]: hue }}>
        <div className="detail">
          <div>
            <ProductPhoto
              sku={p.sku}
              brand={p.brand}
              family={p.scent_family}
              variant="detail"
              className="detail-glyph"
              imageUrl={p.image_url}
              imageTransparentUrl={p.image_transparent_url}
            />

            <p className="brand">{p.brand}</p>
            <h1>{p.product_name}</h1>
            <p className="spec">
              {[p.concentration, p.size, p.gender].filter(Boolean).join(" · ")}
            </p>

            <SizeSelector sizes={sizes} currentSku={p.sku} />

            {p.description && <p className="detail-blurb">{p.description}</p>}

            <p className="detail-price">{price(p.price_cents)}</p>

            {/* Card details never touch our server: checkout tokenizes with
                Square's Web Payments SDK client-side. Two separate <form>s
                side by side (not nested -- HTML forbids that) so "add to
                cart" and "save for later" submit independently. */}
            <div className="detail-actions">
              <AddToCartForm sku={p.sku} quantityId="quantity" />

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
