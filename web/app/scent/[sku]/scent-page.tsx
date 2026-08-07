import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, hueFor, price } from "@/lib/products";
import { addToCartAction } from "@/lib/actions/cart";

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

  return (
    <main className="wrap">
      <Link href="/" className="back">
        ← Back to the shelf
      </Link>

      <div className="detail">
        <div>
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
              Add to bag
            </button>
          </form>
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
                    <span
                      className="note"
                      key={n}
                      style={{ borderColor: hue }}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
