"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { hueFor, price } from "@/lib/format";
import type { Product, ProductSizeOption } from "@/lib/products";
import { AddToCartForm } from "./add-to-cart-form";
import { ProductPhoto } from "./product-photo";
import { SizeSelector } from "./size-selector";

export function ProductCard({
  product,
  sizes,
  minPriceCents,
  maxPriceCents,
}: {
  product: Product;
  /** Sibling sizes of the same fragrance (see lib/products.ts's
   *  getProductGroups) -- optional and unused by every call site except
   *  the main grid (app/page.tsx). Omitting it (the "You might also like"
   *  rail, the wishlist page) keeps this card's single-SKU behavior
   *  exactly as it's always been. */
  sizes?: ProductSizeOption[];
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const href = `/scent/${product.sku}`;
  const hue = hueFor(product.scent_family);
  // A group with 2+ sizes shows the size links in place of the usual
  // price/Add-to-cart/Quick-view block -- picking a size and adding to
  // cart both stay a detail-page action for those (see the plan this was
  // built from: cart never has to guess which size a tile-level click
  // meant). A single-size group (the common case) falls through to the
  // exact same rendering as before this feature existed.
  const hasMultipleSizes = (sizes?.length ?? 0) >= 2;
  const priceLabel =
    minPriceCents != null && maxPriceCents != null && maxPriceCents > minPriceCents
      ? `from ${price(minPriceCents)}`
      : price(minPriceCents ?? product.price_cents);

  // Lock background scroll and let Escape close the modal while it's open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="card">
      <div className="rail" aria-hidden="true">
        <span className="top" style={{ background: hue }} />
        <span className="heart" style={{ background: hue }} />
        <span className="base" style={{ background: hue }} />
      </div>

      {/* Covers the whole card so it's one click target to the detail page;
          the visible content stays in normal flow underneath it (see
          .card-link in globals.css) -- "Quick view" sits at a higher
          z-index so it stays independently clickable. prefetch={false}:
          Next.js prefetches every visible Link by default, and a grid page
          has dozens of these on screen at once -- each one is a detail
          page with several of its own queries (product, similar products,
          session, wishlist status), so left on default this was firing off
          dozens of extra DB-backed page loads on every grid view for no
          reason, competing for the same limited Postgres connections. */}
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
        {/* Size dropped from this line once there's more than one on
            record -- the size links below are what actually says which
            sizes exist; showing just the cheapest one's size here would
            read as the only size, not a starting point. */}
        {(hasMultipleSizes ? [product.concentration] : [product.concentration, product.size])
          .filter(Boolean)
          .join(" · ")}
      </p>
      {product.description && <p className="blurb">{product.description}</p>}

      <div className="card-foot">
        <span className="price">{priceLabel}</span>
        <span className="stock">{product.scent_family}</span>
      </div>

      {hasMultipleSizes ? (
        <SizeSelector sizes={sizes!} />
      ) : (
        <button type="button" className="quick-view-trigger" onClick={() => setOpen(true)}>
          Quick view
        </button>
      )}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <QuickViewModal product={product} href={href} onClose={() => setOpen(false)} />,
          document.body
        )}
    </div>
  );
}

function QuickViewModal({
  product,
  href,
  onClose,
}: {
  product: Product;
  href: string;
  onClose: () => void;
}) {
  return (
    <div className="quickview-backdrop" onClick={onClose}>
      <div
        className="quickview-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${product.brand} ${product.product_name}, quick view`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="quickview-close"
          onClick={onClose}
          aria-label="Close quick view"
        >
          ×
        </button>

        <ProductPhoto
          sku={product.sku}
          brand={product.brand}
          family={product.scent_family}
          variant="quickview"
          className="quickview-glyph"
          imageUrl={product.image_url}
          imageTransparentUrl={product.image_transparent_url}
        />

        <div className="quickview-body">
          <p className="brand">{product.brand}</p>
          <h2 className="name">{product.product_name}</h2>
          <p className="spec">
            {[product.concentration, product.size].filter(Boolean).join(" · ")}
          </p>
          {product.description && <p className="blurb">{product.description}</p>}
          <p className="detail-price">{price(product.price_cents)}</p>

          <AddToCartForm sku={product.sku} quantityId="quickview-quantity" onSubmitted={onClose} />

          <Link href={href} className="quickview-detail-link" onClick={onClose} prefetch={false}>
            View full details →
          </Link>
        </div>
      </div>
    </div>
  );
}
