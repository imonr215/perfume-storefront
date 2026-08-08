"use client";

import { useCartCount } from "@/lib/cart-context";

export function CartBadgeLabel() {
  const { count } = useCartCount();
  return <>Cart{count > 0 ? ` (${count})` : ""}</>;
}
