"use server";

import { revalidatePath } from "next/cache";
import { addToCart, updateCartItemQuantity, removeFromCart } from "@/lib/cart";

function clampQuantity(value: FormDataEntryValue | null, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(20, Math.trunc(n)));
}

export async function addToCartAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  if (!sku) return;
  const quantity = clampQuantity(formData.get("quantity"), 1) || 1;
  await addToCart(sku, quantity);
  revalidatePath("/", "layout");
}

export async function updateCartItemAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  if (!sku) return;
  await updateCartItemQuantity(sku, clampQuantity(formData.get("quantity"), 0));
  revalidatePath("/", "layout");
}

export async function removeFromCartAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  if (!sku) return;
  await removeFromCart(sku);
  revalidatePath("/", "layout");
}
