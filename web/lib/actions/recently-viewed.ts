"use server";

import { cookies } from "next/headers";
import { RECENTLY_VIEWED_COOKIE, RECENTLY_VIEWED_MAX } from "@/lib/recently-viewed";

/** Fire-and-forget: called from a client component on the product detail
 *  page (see app/scent/[sku]/record-view.tsx). Moves `sku` to the front,
 *  dedupes, caps the list -- most-recently-viewed first. */
export async function recordProductView(sku: string): Promise<void> {
  if (!sku) return;
  const store = await cookies();
  const raw = store.get(RECENTLY_VIEWED_COOKIE)?.value;
  let skus: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) skus = parsed.filter((s): s is string => typeof s === "string");
    } catch {
      skus = [];
    }
  }

  const next = [sku, ...skus.filter((s) => s !== sku)].slice(0, RECENTLY_VIEWED_MAX);

  store.set(RECENTLY_VIEWED_COOKIE, JSON.stringify(next), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });
}
