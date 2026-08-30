import Link from "next/link";
import {
  getConcentrations,
  getFamilies,
  getGenders,
  getProductGroups,
  getProductGroupsCount,
  getRandomProducts,
  getSizes,
  PRODUCTS_PAGE_SIZE,
} from "@/lib/products";
import { ProductCard } from "@/app/components/product-card";
import { FamilyHero } from "@/app/components/family-hero";

export const dynamic = "force-dynamic";

const PRICE_BUCKETS: Record<string, { min?: number; max?: number; label: string }> = {
  "under-75": { max: 7500, label: "Under $75" },
  "75-150": { min: 7500, max: 15000, label: "$75 to $150" },
  "150-250": { min: 15000, max: 25000, label: "$150 to $250" },
  "250-plus": { min: 25000, label: "$250+" },
};

type SearchParams = {
  q?: string;
  family?: string;
  gender?: string;
  concentration?: string;
  size?: string;
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
  const size = sp.size || undefined;
  const priceBucket = sp.price && PRICE_BUCKETS[sp.price] ? sp.price : undefined;
  const bucket = priceBucket ? PRICE_BUCKETS[priceBucket] : undefined;

  const activeFilterCount = [q, family, gender, concentration, size, priceBucket].filter(
    Boolean
  ).length;
  const page = Math.max(1, Number(sp.page) || 1);

  const productFilters = {
    family,
    gender,
    concentration,
    size,
    q,
    priceMinCents: bucket?.min,
    priceMaxCents: bucket?.max,
  };

  const [groups, total, families, genders, concentrations, sizes] = await Promise.all([
    getProductGroups(productFilters, page),
    getProductGroupsCount(productFilters),
    getFamilies(),
    getGenders(),
    getConcentrations(),
    getSizes(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  // An empty page can mean two different things: the filters themselves
  // matched nothing (total === 0), or they matched plenty but `page` (from
  // a hand-edited URL, a stale bookmark, or the catalog having shrunk since
  // a link was saved) is past the last real page. Only the first case is
  // actually "nothing matches" -- conflating them made a search that had
  // 300+ real matches say "nothing matches those filters" just because
  // ?page=9999 was in the URL.
  const pageOutOfRange = total > 0 && page > totalPages;

  // A dead-end search/filter combo shouldn't be a dead end for the visit --
  // offer a few random bottles to keep browsing instead of just stopping.
  // Skipped for an out-of-range page: the filters already have real
  // matches (just not on this page), so a random-bottles fallback would be
  // both unnecessary and a non-sequitur next to "back to page 1".
  const fallbackProducts =
    groups.length === 0 && !pageOutOfRange ? await getRandomProducts(4) : [];

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

          {/* No name/value pair needed here anymore: family is a plain
              <select> now (see .filters-prominent below), so it always
              self-submits its own current value regardless of which
              button was clicked -- carrying it forward by hand here would
              submit a second, stale "family" field alongside the select's
              live one. */}
          <button type="submit" className="search-submit">
            Search
          </button>
        </div>

        {/* Gender, concentration, size, price, and scent family: five
            equal, always-visible rows -- what a passing kiosk shopper
            filters by, all on-screen at once rather than any of them
            tucked behind a toggle. Plain <select>s throughout, so picking
            one doesn't submit by itself -- "Update results" (or Search
            above) is what applies them. */}
        <div className="filters-prominent">
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
            <span className="filter-field-label">Size</span>
            <select name="size" defaultValue={size ?? ""}>
              <option value="">Any size</option>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
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

          <label className="filter-field">
            <span className="filter-field-label">Scent family</span>
            <select name="family" defaultValue={family ?? ""}>
              <option value="">Any family</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="filter-apply">
            Update results
          </button>
        </div>

        {activeFilterCount > 0 && (
          <Link href="/" className="filter-clear">
            Clear all filters
          </Link>
        )}
      </form>

      {family && <FamilyHero family={family} products={groups.map((g) => g.product)} />}

      <p className="count">
        {total} {total === 1 ? "bottle" : "bottles"}
        {family ? ` in ${family}` : ""}
        {q ? ` matching “${q}”` : ""}
      </p>

      {groups.length === 0 ? (
        <>
          <p className="empty">
            {pageOutOfRange ? (
              <>
                That page doesn&apos;t exist -- there {totalPages === 1 ? "is" : "are"} only{" "}
                {totalPages} {totalPages === 1 ? "page" : "pages"} of results here.{" "}
                <Link href={pageHref(1)} style={{ color: "var(--amber)" }}>
                  Back to page 1
                </Link>
                .
              </>
            ) : (
              <>
                Nothing matches those filters yet. Try loosening one, or{" "}
                <Link href="/" style={{ color: "var(--amber)" }}>
                  see everything
                </Link>
                .
              </>
            )}
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
            {groups.map((g) => (
              <ProductCard
                key={g.product.sku}
                product={g.product}
                sizes={g.sizes}
                concentrations={g.concentrations}
                minPriceCents={g.minPriceCents}
                maxPriceCents={g.maxPriceCents}
              />
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
