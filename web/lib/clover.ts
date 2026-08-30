/**
 * Clover Platform API client (server-side only).
 *
 * Two hard-won facts from live sandbox verification this session, not
 * documentation: the working host is `api.clover.com` (the PRODUCTION
 * Platform API host) even for a sandbox test merchant -- sandbox.dev.clover.com
 * returned a clean 401 for every call tried. And auth is a genuine OAuth
 * access_token (see app/api/webhooks/clover-oauth-capture/route.ts for that
 * flow), NOT the merchant-dashboard-generated "Platform API" token, which
 * 401'd on every call including a plain GET of the merchant object itself.
 *
 * No official Clover Node SDK exists (confirmed) -- this hand-rolls a thin
 * fetch() client rather than adding an unofficial third-party package, same
 * reasoning as etl/clover_client.py on the Python side.
 */

const PLATFORM_HOST = "https://api.clover.com";

function merchantId(): string {
  const id = process.env.CLOVER_MERCHANT_ID;
  if (!id) throw new Error("CLOVER_MERCHANT_ID is not set");
  return id;
}

function apiToken(): string {
  const token = process.env.CLOVER_API_TOKEN;
  if (!token) throw new Error("CLOVER_API_TOKEN is not set");
  return token;
}

async function cloverFetch(path: string, init?: RequestInit) {
  const resp = await fetch(`${PLATFORM_HOST}/v3/merchants/${merchantId()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Clover API ${resp.status}: ${body}`) as Error & {
      status?: number;
      body?: string;
    };
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return resp.status === 204 ? null : resp.json();
}

/**
 * Clover doesn't ship an error class the way Square's SDK does, but the same
 * Next.js per-route-bundling identity hazard documented for squareApiErrors
 * would apply to any hand-rolled error class here too -- duck-type the shape
 * instead of relying on `instanceof`, for consistency and because a plain
 * Error subclass would hit the identical problem.
 */
export function cloverApiErrors(err: unknown): { detail?: string }[] | null {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (typeof body === "string" && body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed?.message) return [{ detail: parsed.message }];
      } catch {
        // fall through
      }
    }
  }
  return null;
}

/**
 * Clover is the customer system of record for anything order-related, same
 * role Square played before. Search by email before creating so repeat
 * guest checkouts (and a customer's first order after signing up) attach to
 * the same Clover customer instead of spawning duplicates.
 */
export async function findOrCreateCloverCustomer(
  email: string,
  name?: string | null
): Promise<string> {
  const search = await cloverFetch(
    `/customers?filter=${encodeURIComponent(`emailAddress=${email}`)}`
  );
  const existing = search?.elements?.[0]?.id;
  if (existing) return existing;

  const [firstName, ...rest] = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const created = await cloverFetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: rest.length ? rest.join(" ") : undefined,
      emailAddresses: [{ emailAddress: email }],
    }),
  });
  if (!created?.id) throw new Error("Clover did not return a customer id");
  return created.id;
}

export type CloverDevice = { id: string; serial?: string; name?: string };

/** Lists devices paired to this merchant -- empty for a sandbox test
 * merchant with no physical hardware attached (expected; see the migration
 * plan's Phase 6/7 split). Used to find the kiosk's Flex `deviceId`. */
export async function listDevices(): Promise<CloverDevice[]> {
  const data = await cloverFetch("/devices");
  return data?.elements ?? [];
}

export async function getOrder(orderId: string, expand?: string) {
  const query = expand ? `?expand=${encodeURIComponent(expand)}` : "";
  return cloverFetch(`/orders/${orderId}${query}`);
}
