import Link from "next/link";
import {
  getConcentrations,
  getFamilies,
  getGenders,
  getProducts,
  getProductsBySkus,
  getProductsCount,
  getRandomProducts,
  price,
  PRODUCTS_PAGE_SIZE,
} from "@/lib/products";
import { getRecentlyViewedSkus } from "@/lib/recently-viewed";
import { ProductCard } from "@/app/components/product-card";
import { BottleGlyph } from "@/app/components/bottle-glyph";
import { ScrollActiveFamilyIntoView } from "@/app/scroll-active-family";

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
  page?: string;
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
  const page = Math.max(1, Number(sp.page) || 1);

  const productFilters = {
    family,
    gender,
    concentration,
    q,
    priceMinCents: bucket?.min,
    priceMaxCents: bucket?.max,
  };

  const [products, total, families, genders, concentrations, recentSkus] = await Promise.all([
    getProducts(productFilters, page),
    getProductsCount(productFilters),
    getFamilies(),
    getGenders(),
    getConcentrations(),
    getRecentlyViewedSkus(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));

  // Only on the default, unfiltered landing view -- once someone's actively
  // searching or filtering, a "recently viewed" rail is just clutter above
  // the results they asked for.
  const recentProducts =
    activeFilterCount === 0 && recentSkus.length > 0 ? await getProductsBySkus(recentSkus) : [];

  // A dead-end search/filter combo shouldn't be a dead end for the visit --
  // offer a few random bottles to keep browsing instead of just stopping.
  const fallbackProducts = products.length === 0 ? await getRandomProducts(4) : [];

  // Pagination links need every OTHER current param preserved, with just
  // `page` swapped -- built from the raw searchParams rather than the
  // normalized q/family/etc. above, so anything not explicitly modeled
  // here (there isn't any today, but this stays correct if that changes)
  // still round-trips.
  function pageHref(n: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (key !== "page" && value) params.set(key, value);
    }
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  return (
    <main className="wrap">
      <section className="opening">
        <h1 className="page-title">Browse the shelf.</h1>
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
          <button
            type="submit"
            name="family"
            value=""
            className="family"
            data-active={!family}
          >
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

      <ScrollActiveFamilyIntoView />

      {recentProducts.length > 0 && (
        <section className="recent-rail">
          <h2 className="section-label">Recently viewed</h2>
          <div className="recent-rail-scroll">
            {recentProducts.map((p) => (
              <Link
                key={p.sku}
                href={`/scent/${p.sku}`}
                className="recent-item"
                prefetch={false}
              >
                <BottleGlyph
                  sku={p.sku}
                  brand={p.brand}
                  family={p.scent_family}
                  variant="recent"
                  className="recent-item-glyph"
                />
                <p className="recent-item-name">{p.product_name}</p>
                <p className="recent-item-price">{price(p.price_cents)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="count">
        {total} {total === 1 ? "bottle" : "bottles"}
        {family ? ` in ${family}` : ""}
        {q ? ` matching “${q}”` : ""}
      </p>

      {products.length === 0 ? (
        <>
          <p className="empty">
            Nothing matches those filters yet. Try loosening one, or{" "}
            <Link href="/" style={{ color: "var(--amber)" }}>
              see everything
            </Link>
            .
          </p>
          {fallbackProducts.length > 0 && (
            <section className="similar-section">
              <h2 className="section-label">You might like</h2>
              <div className="grid">
                {fallbackProducts.map((p) => (
                  <ProductCard key={p.sku} product={p} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="grid">
            {products.map((p) => (
              <ProductCard key={p.sku} product={p} />
            ))}
          </div>

          {totalPages > 1 && (
            // prefetch={false}: each of these runs the full home-page query
            // set (products + count + families + genders + concentrations)
            // -- prefetching them on every grid view means two extra full
            // page loads' worth of queries running for pages nobody's
            // asked for yet.
            <nav className="pagination" aria-label="Pagination">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="pagination-link" prefetch={false}>
                  ← Previous
                </Link>
              ) : (
                <span className="pagination-link" aria-disabled="true">
                  ← Previous
                </span>
              )}
              <span className="pagination-status">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} className="pagination-link" prefetch={false}>
                  Next →
                </Link>
              ) : (
                <span className="pagination-link" aria-disabled="true">
                  Next →
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
