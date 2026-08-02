import Link from "next/link";
import { getProducts, getFamilies, hueFor, price } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ family?: string }>;
}) {
  const { family } = await searchParams;
  const [products, families] = await Promise.all([
    getProducts(family),
    getFamilies(),
  ]);

  return (
    <main className="wrap">
      <section className="opening">
        <h1>
          What are you in the <em>mood</em> for?
        </h1>
        <p>
          Everything on our shelf, including the bottles we can&apos;t fit in the
          kiosk. Pick a family to narrow it down, or scroll the whole thing.
        </p>
      </section>

      <nav className="families" aria-label="Filter by scent family">
        <Link href="/" className="family" data-active={!family}>
          Everything
        </Link>
        {families.map((f) => (
          <Link
            key={f}
            href={`/?family=${encodeURIComponent(f)}`}
            className="family"
            data-active={family === f}
          >
            {f}
          </Link>
        ))}
      </nav>

      <p className="count">
        {products.length} {products.length === 1 ? "bottle" : "bottles"}
        {family ? ` in ${family}` : ""}
      </p>

      {products.length === 0 ? (
        <p className="empty">
          Nothing on the shelf in that family yet. Try another, or{" "}
          <Link href="/" style={{ color: "var(--amber)" }}>
            see everything
          </Link>
          .
        </p>
      ) : (
        <div className="grid">
          {products.map((p) => {
            const hue = hueFor(p.scent_family);
            return (
              <Link key={p.sku} href={`/scent/${p.sku}`} className="card">
                <div className="rail" aria-hidden="true">
                  <span className="top" style={{ background: hue }} />
                  <span className="heart" style={{ background: hue }} />
                  <span className="base" style={{ background: hue }} />
                </div>

                <p className="brand">{p.brand}</p>
                <h2 className="name">{p.product_name}</h2>
                <p className="spec">
                  {[p.concentration, p.size].filter(Boolean).join(" · ")}
                </p>
                {p.description && <p className="blurb">{p.description}</p>}

                <div className="card-foot">
                  <span className="price">{price(p.price_cents)}</span>
                  <span className="stock">{p.scent_family}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
