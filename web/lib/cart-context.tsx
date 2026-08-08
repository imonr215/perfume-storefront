"use client";

import { createContext, useContext, useState } from "react";

type CartCountContextValue = {
  count: number;
  bump: (delta: number) => void;
};

const CartCountContext = createContext<CartCountContextValue | null>(null);

/**
 * Lets "Add to cart" bump the header badge instantly instead of waiting on
 * the Server Action's round trip (revalidatePath + re-render), which was
 * showing up as a beat of lag between clicking and seeing the count change.
 *
 * `serverCount` is the real, authoritative count from the layout's own
 * getCart() call on every render -- local state re-syncs to it whenever it
 * changes, so an optimistic bump just gets confirmed (or corrected, e.g. if
 * the add actually failed) once the real request finishes. Nothing here
 * touches the cart itself; it's purely a display-layer smoothing.
 */
export function CartCountProvider({
  serverCount,
  children,
}: {
  serverCount: number;
  children: React.ReactNode;
}) {
  const [count, setCount] = useState(serverCount);
  // "Adjusting state when a prop changes" pattern (react.dev) rather than
  // an effect: re-syncing to a fresh server value is exactly the case
  // React's docs call out for setting state during render itself, so the
  // corrected count is ready in the same render instead of flashing the
  // stale one first.
  const [prevServerCount, setPrevServerCount] = useState(serverCount);
  if (serverCount !== prevServerCount) {
    setPrevServerCount(serverCount);
    setCount(serverCount);
  }

  function bump(delta: number) {
    setCount((c) => Math.max(0, c + delta));
  }

  return <CartCountContext.Provider value={{ count, bump }}>{children}</CartCountContext.Provider>;
}

export function useCartCount(): CartCountContextValue {
  const ctx = useContext(CartCountContext);
  if (!ctx) throw new Error("useCartCount must be used within a CartCountProvider");
  return ctx;
}
