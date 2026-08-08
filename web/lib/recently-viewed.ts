import { cookies } from "next/headers";

export const RECENTLY_VIEWED_COOKIE = "recently_viewed";
export const RECENTLY_VIEWED_MAX = 8;

function parseSkus(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Read-only, safe from Server Components -- see lib/cart.ts for the same
 *  read/write split and why it matters (cookies can't be set while
 *  rendering a Server Component). */
export async function getRecentlyViewedSkus(): Promise<string[]> {
  const store = await cookies();
  return parseSkus(store.get(RECENTLY_VIEWED_COOKIE)?.value);
}
