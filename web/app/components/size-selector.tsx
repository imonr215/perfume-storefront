import Link from "next/link";
import type { ProductSizeOption } from "@/lib/products";

/**
 * Lets a shopper switch between sizes of the *same* fragrance (same brand,
 * name, and concentration -- see getProductSizes) without leaving the
 * detail page's context. Each size is its own SKU/row/URL, so this is a
 * set of plain links to the sibling's own /scent/[sku] page rather than
 * client state -- consistent with the rest of the site's no-JS-required
 * browsing (family pills, pagination). A real navigation also means price,
 * description, and "You might also like" all recompute correctly for the
 * newly-selected size instead of needing to be kept in sync by hand.
 *
 * Renders nothing when there's only one size on record -- a selector with
 * a single, already-selected option isn't a choice, just clutter.
 */
export function SizeSelector({
  sizes,
  currentSku,
}: {
  sizes: ProductSizeOption[];
  currentSku: string;
}) {
  if (sizes.length < 2) return null;

  return (
    <div className="size-field">
      <span className="size-field-label">Size</span>
      <div className="size-selector" role="group" aria-label="Size">
        {sizes.map((s) => {
          const active = s.sku === currentSku;
          return (
            <Link
              key={s.sku}
              href={`/scent/${s.sku}`}
              className="size-option"
              data-active={active}
              aria-current={active ? "page" : undefined}
              prefetch={false}
            >
              {s.size ?? "—"}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
