"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { hueFor, price } from "@/lib/format";
import { addToCartAction } from "@/lib/actions/cart";
import type { Product } from "@/lib/products";
import { BottleGlyph } from "./bottle-glyph";

export function ProductCard({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const href = `/scent/${product.sku}`;
  const hue = hueFor(product.scent_family);

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
          z-index so it stays independently clickable. */}
      <Link href={href} className="card-link">
        <span className="sr-only">{`${product.brand} ${product.product_name}`}</span>
      </Link>

      <BottleGlyph
        sku={product.sku}
        brand={product.brand}
        family={product.scent_family}
        variant="card"
        className="card-glyph"
      />

      <p className="brand">{product.brand}</p>
      <h2 className="name">{product.product_name}</h2>
      <p className="spec">{[product.concentration, product.size].filter(Boolean).join(" · ")}</p>
      {product.description && <p className="blurb">{product.description}</p>}

      <div className="card-foot">
        <span className="price">{price(product.price_cents)}</span>
        <span className="stock">{product.scent_family}</span>
      </div>

      <button type="button" className="quick-view-trigger" onClick={() => setOpen(true)}>
        Quick view
      </button>

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

        <BottleGlyph
          sku={product.sku}
          brand={product.brand}
          family={product.scent_family}
          variant="quickview"
          className="quickview-glyph"
        />

        <div className="quickview-body">
          <p className="brand">{product.brand}</p>
          <h2 className="name">{product.product_name}</h2>
          <p className="spec">
            {[product.concentration, product.size].filter(Boolean).join(" · ")}
          </p>
          {product.description && <p className="blurb">{product.description}</p>}
          <p className="detail-price">{price(product.price_cents)}</p>

          <form action={addToCartAction} className="add-to-bag" onSubmit={onClose}>
            <input type="hidden" name="sku" value={product.sku} />
            <input type="hidden" name="quantity" value="1" />
            <button className="buy" type="submit">
              Add to cart
            </button>
          </form>

          <Link href={href} className="quickview-detail-link" onClick={onClose}>
            View full details →
          </Link>
        </div>
      </div>
    </div>
  );
}
