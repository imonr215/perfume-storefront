import Link from "next/link";
import { hueFor, price } from "@/lib/format";
import type { Product, ProductConcentrationOption, ProductSizeOption } from "@/lib/products";
import { ProductPhoto } from "./product-photo";
import { SizeSelector } from "./size-selector";
import { ConcentrationSelector } from "./concentration-selector";

export function ProductCard({
  product,
  sizes,
  concentrations,
  minPriceCents,
  maxPriceCents,
}: {
  product: Product;
  /** Sibling sizes/concentrations of the same fragrance (see lib/products.ts's
   *  getProductGroups) -- both optional and unused by every call site except
   *  the main grid (app/page.tsx). Omitting them (the "You might also like"
   *  rail, the wishlist page) keeps this card's single-SKU behavior
   *  exactly as it's always been. */
  sizes?: ProductSizeOption[];
  concentrations?: ProductConcentrationOption[];
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
}) {
  const href = `/scent/${product.sku}`;
  const hue = hueFor(product.scent_family);
  // A group with 2+ sizes and/or 2+ concentrations shows those links in
  // place of the plain price line -- picking a size or concentration and
  // adding to cart both stay a detail-page action for those (cart never
  // has to guess which variant a tile-level click meant). A single-variant
  // group (the common case) just shows its price; the whole card is
  // already a click-through to the detail page (see .card-link below),
  // there used to be a separate "Quick view" modal shortcut here too, but
  // it was pure duplication of that same click-through and got removed.
  const hasMultipleSizes = (sizes?.length ?? 0) >= 2;
  const hasMultipleConcentrations = (concentrations?.length ?? 0) >= 2;
  const hasVariants = hasMultipleSizes || hasMultipleConcentrations;
  const priceLabel =
    minPriceCents != null && maxPriceCents != null && maxPriceCents > minPriceCents
      ? `from ${price(minPriceCents)}`
      : price(minPriceCents ?? product.price_cents);

  return (
    <div className="card">
      <div className="rail" aria-hidden="true">
        <span className="top" style={{ background: hue }} />
        <span className="heart" style={{ background: hue }} />
        <span className="base" style={{ background: hue }} />
      </div>

      {/* Covers the whole card so it's one click target to the detail page;
          the visible content stays in normal flow underneath it (see
          .card-link in globals.css) -- the size/concentration selectors
          below sit at a higher z-index so they stay independently
          clickable. prefetch={false}: Next.js prefetches every visible
          Link by default, and a grid page has dozens of these on screen at
          once -- each one is a detail page with several of its own
          queries (product, similar products, session, wishlist status),
          so left on default this was firing off dozens of extra
          DB-backed page loads on every grid view for no reason, competing
          for the same limited Postgres connections. */}
      <Link href={href} className="card-link" prefetch={false}>
        <span className="sr-only">{`${product.brand} ${product.product_name}`}</span>
      </Link>

      <ProductPhoto
        sku={product.sku}
        brand={product.brand}
        family={product.scent_family}
        variant="card"
        className="card-glyph"
        imageUrl={product.image_url}
        imageTransparentUrl={product.image_transparent_url}
      />

      <p className="brand">{product.brand}</p>
      <h2 className="name">{product.product_name}</h2>
      <p className="spec">
        {/* Concentration and/or size dropped from this line once either
            varies within the group -- the selectors below are what
            actually say which concentrations/sizes exist; showing just the
            cheapest variant's own values here would read as the only
            option, not a starting point. */}
        {(hasMultipleConcentrations
          ? []
          : hasMultipleSizes
            ? [product.concentration]
            : [product.concentration, product.size]
        )
          .filter(Boolean)
          .join(" · ")}
      </p>
      {product.description && <p className="blurb">{product.description}</p>}

      <div className="card-foot">
        <span className="price">{priceLabel}</span>
        <span className="stock">{product.scent_family}</span>
      </div>

      {hasVariants && (
        <>
          <ConcentrationSelector concentrations={concentrations ?? []} />
          <SizeSelector sizes={sizes ?? []} />
        </>
      )}
    </div>
  );
}
