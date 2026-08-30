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

  // A dead-end search/filter combo shouldn't be a dead end for the visit --
  // offer a few random bottles to keep browsing instead of just stopping.
  const fallbackProducts = groups.length === 0 ? await getRandomProducts(4) : [];

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

          <button type="submit" name="family" value={family ?? ""} className="search-submit">
            Search
          </button>
        </div>

        {/* Gender, concentration, size, and price: the four things a
            passing kiosk shopper actually thinks in, so these stay
            on-screen at all times instead of behind a toggle -- scent
            family moved out to make room (see the toggle below) since it's
            the one dimension a first-time customer is likeliest to find
            confusing rather than useful. Still plain <select>s, so picking
            one doesn't submit by itself -- "Update results" (or Search
            above) is what applies them, same as every other control in
            this form. */}
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

          {/* name="family" here too: submit buttons only contribute their
              pair when THEY'RE the one clicked, so without this a click on
              "Update results" would silently drop whatever family was
              already active in the toggle below. */}
          <button type="submit" name="family" value={family ?? ""} className="filter-apply">
            Update results
          </button>
        </div>

        {activeFilterCount > 0 && (
          <Link href="/" className="filter-clear">
            Clear all filters
          </Link>
        )}

        {/* Scent family: secondary and collapsed by default, native
            <details> so the toggle needs no JS. Each pill is its own
            type="submit" button carrying its own family=... -- safe to mix
            with the plain <select>s above since a submit button only ever
            contributes its own pair, and every other control here always
            self-submits its current value regardless of which button was
            clicked (see the top-level .filter-form comment). */}
        <details className="filters-dropdown">
          <summary className="filters-toggle">
            Scent family{family ? ` (${family})` : ""}
          </summary>
          <div className="filters-panel">
            <div
              className="filters-panel-families"
              role="group"
              aria-label="Filter by scent family"
            >
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
            </div>
          </div>
        </details>
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
