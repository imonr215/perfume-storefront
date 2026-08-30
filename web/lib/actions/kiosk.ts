"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { destroySession } from "@/lib/auth";

/**
 * Called by the kiosk-only idle timer (see
 * app/components/kiosk-idle-reset.tsx) once nobody's touched the shared
 * iPad for a while -- wipes whatever the last customer was doing so the
 * next person to pick up the device starts clean, not mid-someone-else's-
 * order or, worse, logged into their account.
 *
 * Deletes the guest cart's own row (customer_id IS NULL -- store_cart_items
 * cascades) rather than just its cookie, so an abandoned guest cart doesn't
 * linger forever in the DB. A signed-in customer's cart is left completely
 * alone: it's their real, persistent account cart, the same one they'd see
 * logging in from home, not something that belongs to this device. Deleting
 * the cookies below is what actually protects the next customer either
 * way -- without them, nothing on this shared device can reach either cart
 * or session again regardless of what's left in the database.
 */
export async function resetKioskSessionAction(): Promise<void> {
  const store = await cookies();
  const cartId = store.get("cart_id")?.value;

  if (cartId) {
    await sql`DELETE FROM store_carts WHERE id = ${cartId} AND customer_id IS NULL`;
  }
  store.delete("cart_id");

  await destroySession();

  revalidatePath("/", "layout");
  redirect("/");
}
