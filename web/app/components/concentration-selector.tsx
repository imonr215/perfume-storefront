import Link from "next/link";
import type { ProductConcentrationOption } from "@/lib/products";

/**
 * Sibling of SizeSelector, same pattern: plain links to each concentration's
 * own cheapest-SKU page rather than client state, so picking a concentration
 * is a real navigation (price, sizes, notes all recompute for whatever
 * lands there) instead of something that needs keeping in sync by hand.
 *
 * Concentration stays a genuinely separate product underneath (own SKU, own
 * price, own dim_products row -- see etl/sku.py) even though it's now
 * presented as a second selectable dimension alongside size rather than its
 * own tile/group boundary. This selector is what makes that relationship
 * visible without collapsing it.
 *
 * Renders nothing when there's only one concentration on record, same
 * reasoning as SizeSelector. `currentSku` is optional for the same reason
 * too: a grid tile representing the whole (brand, product name) group has
 * no single "current" concentration to mark active.
 */
export function ConcentrationSelector({
  concentrations,
  currentSku,
}: {
  concentrations: ProductConcentrationOption[];
  currentSku?: string;
}) {
  if (concentrations.length < 2) return null;

  return (
    <div className="size-field">
      <span className="size-field-label">Concentration</span>
      <div className="size-selector" role="group" aria-label="Concentration">
        {concentrations.map((c) => {
          const active = c.sku === currentSku;
          return (
            <Link
              key={c.sku}
              href={`/scent/${c.sku}`}
              className="size-option"
              data-active={active}
              aria-current={active ? "page" : undefined}
              prefetch={false}
            >
              {c.concentration ?? "—"}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
