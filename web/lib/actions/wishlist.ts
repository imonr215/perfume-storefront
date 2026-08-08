"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { toggleWishlist } from "@/lib/wishlist";

/** Treat every action as an untrusted entry point: re-check the session
 *  here rather than trusting that the button was only rendered for a
 *  logged-in customer. `path` is the page the form was submitted from, so
 *  the response can re-render that same route in one round trip. */
export async function toggleWishlistAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const sku = String(formData.get("sku") ?? "");
  if (!sku) return;

  await toggleWishlist(session.id, sku);

  const path = String(formData.get("path") ?? "");
  if (path) revalidatePath(path);
}
