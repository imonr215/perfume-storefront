"use client";

import { addToCartAction } from "@/lib/actions/cart";
import { useCartCount } from "@/lib/cart-context";

/**
 * Shared by the detail page and the quick-view modal. Still a plain
 * <form action={addToCartAction}> under the hood -- the onSubmit here
 * doesn't preventDefault, it just bumps the header badge optimistically
 * alongside the real submission (see lib/cart-context.tsx).
 */
export function AddToCartForm({
  sku,
  quantityId,
  onSubmitted,
}: {
  sku: string;
  quantityId: string;
  onSubmitted?: () => void;
}) {
  const { bump } = useCartCount();

  return (
    <form
      action={addToCartAction}
      className="add-to-bag"
      onSubmit={(event) => {
        const quantity = Number(new FormData(event.currentTarget).get("quantity")) || 1;
        bump(quantity);
        onSubmitted?.();
      }}
    >
      <input type="hidden" name="sku" value={sku} />
      <label className="sr-only" htmlFor={quantityId}>
        Quantity
      </label>
      <select id={quantityId} name="quantity" defaultValue="1" className="add-to-bag-qty">
        {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button className="buy" type="submit">
        Add to cart
      </button>
    </form>
  );
}
