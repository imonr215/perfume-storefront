import Link from "next/link";
import { getConcentrations, getFamilies, getGenders, getProducts } from "@/lib/products";
import { ProductCard } from "@/app/components/product-card";

export const dynamic = "force-dynamic";

const PRICE_BUCKETS: Record<string, { min?: number; max?: number; label: string }> = {
  "under-75": { max: 7500, label: "Under $75" },
  "75-150": { min: 7500, max: 15000, label: "$75–$150" },
  "150-250": { min: 15000, max: 25000, label: "$150–$250" },
  "250-plus": { min: 25000, label: "$250+" },
};

type SearchParams = {
  q?: string;
  family?: string;
  gender?: string;
  concentration?: string;
  price?: string;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  // Empty strings from a submitted-but-blank <select> should behave the
  // same as the param being absent entirely.
  const q = sp.q?.trim() || undefined;
  const family = sp.family || undefined;
  const gender = sp.gender || undefined;
  const concentration = sp.concentration || undefined;
  const priceBucket = sp.price && PRICE_BUCKETS[sp.price] ? sp.price : undefined;
  const bucket = priceBucket ? PRICE_BUCKETS[priceBucket] : undefined;

  const selectFilterCount = [gender, concentration, priceBucket].filter(Boolean).length;
  const activeFilterCount = [q, family, gender, concentration, priceBucket].filter(Boolean).length;

  const [products, families, genders, concentrations] = await Promise.all([
    getProducts({
      family,
      gender,
      concentration,
      q,
      priceMinCents: bucket?.min,
      priceMaxCents: bucket?.max,
    }),
    getFamilies(),
    getGenders(),
    getConcentrations(),
  ]);

  return (
    <main className="wrap">
      <section className="opening">
        <h1>
          What are you in the <em>mood</em> for?
        </h1>
        <p>
          Everything on our shelf, including the bottles we can&apos;t fit in the
          kiosk. Search by name or note, narrow it down by family, or scroll the
          whole thing.
        </p>
      </section>

      <form method="GET" action="/" className="filter-form">
        <div className="search-row">
          <label className="sr-only" htmlFor="q">
            Search by brand, name, or note
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search “bergamot”, “Dior”, “Sauvage”…"
            className="search-input"
          />

          {/* Native disclosure widget, not a client component: the panel's
              form controls submit with the rest of the form regardless of
              whether it's open or closed (CSS display:none on closed
              <details> content doesn't exclude form fields from submission),
              so this needs zero JS to behave like a filters dropdown. */}
          <details className="filters-dropdown">
            <summary className="filters-toggle">
              Filters{selectFilterCount > 0 ? ` (${selectFilterCount})` : ""}
            </summary>
            <div className="filters-panel">
              <label className="filter-field">
                <span className="filter-field-label">Gender</span>
                <select name="gender" defaultValue={gender ?? ""}>
                  <option value="">Any gender</option>
                  {genders.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter-field">
                <span className="filter-field-label">Concentration</span>
                <select name="concentration" defaultValue={concentration ?? ""}>
                  <option value="">Any concentration</option>
                  {concentrations.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter-field">
                <span className="filter-field-label">Price</span>
                <select name="price" defaultValue={priceBucket ?? ""}>
                  <option value="">Any price</option>
                  {Object.entries(PRICE_BUCKETS).map(([key, b]) => (
                    <option key={key} value={key}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" className="filter-apply">
                Apply filters
              </button>
            </div>
          </details>

          <button type="submit" className="search-submit">
            Search
          </button>
        </div>

        {activeFilterCount > 0 && (
          <Link href="/" className="filter-clear">
            Clear all filters
          </Link>
        )}

        {/* Family pills are submit buttons in the same form, so clicking one
            keeps whatever's currently in the search box and the filters
            dropdown rather than resetting them -- the whole form submits
            together, this button just adds its own family=... field. */}
        <nav className="families" aria-label="Filter by scent family">
          <button type="submit" name="family" value="" className="family" data-active={!family}>
            Everything
          </button>
          {families.map((f) => (
            <button
              key={f}
              type="submit"
              name="family"
              value={f}
              className="family"
              data-active={family === f}
            >
              {f}
            </button>
          ))}
        </nav>
      </form>

      <p className="count">
        {products.length} {products.length === 1 ? "bottle" : "bottles"}
        {family ? ` in ${family}` : ""}
        {q ? ` matching “${q}”` : ""}
      </p>

      {products.length === 0 ? (
        <p className="empty">
          Nothing matches those filters yet. Try loosening one, or{" "}
          <Link href="/" style={{ color: "var(--amber)" }}>
            see everything
          </Link>
          .
        </p>
      ) : (
        <div className="grid">
          {products.map((p) => (
            <ProductCard key={p.sku} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
