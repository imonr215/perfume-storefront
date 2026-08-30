import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Clover webhook receiver.
 *
 * Responsibilities, in order:
 *   1. Handle Clover's one-time ownership-verification challenge.
 *   2. Verify the request actually came from Clover (static X-Clover-Auth
 *      header -- simpler than Square's per-request HMAC, since it's a fixed
 *      shared secret rather than a computed signature; still a
 *      constant-time compare since it's a secret-bearing header).
 *   3. Write every event verbatim into raw_clover_events.
 *   4. Return 200 fast.
 *
 * Deliberately does NOT parse orders into fact tables here -- same raw-first
 * reasoning as the old Square receiver: transformation happens later,
 * reading from the raw table, so a parsing bug can be fixed and replayed
 * rather than losing events.
 *
 * One real difference from Square's shape: a single Clover delivery can
 * bundle multiple events for multiple objects in one POST body
 * (`{"merchants": {merchantId: [{"objectId": "O:xyz", ...}, ...]}}`), so
 * this inserts one row per event, not one row per request.
 */

// Node runtime (not Edge): we need a TCP Postgres connection.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_HEADER = "x-clover-auth";

function isFromClover(signature: string | null): boolean {
  const expected = process.env.CLOVER_WEBHOOK_AUTH_CODE;
  if (!expected || !signature) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type CloverEvent = { objectId?: string; type?: string; ts?: number };

function extractEvents(payload: Record<string, unknown>): { merchantId: string; event: CloverEvent }[] {
  const merchants = (payload.merchants ?? {}) as Record<string, CloverEvent[]>;
  const out: { merchantId: string; event: CloverEvent }[] = [];
  for (const [merchantId, events] of Object.entries(merchants)) {
    for (const event of events ?? []) {
      out.push({ merchantId, event });
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  // Must read the raw text first -- same reasoning as the Square receiver,
  // even though Clover's own check here is a plain header compare rather
  // than a body-derived signature: keeping the same raw-first shape means
  // whatever's stored in raw_clover_events is always the exact bytes Clover
  // sent, not a re-serialized approximation.
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // One-time ownership-verification challenge -- no Square equivalent.
  // Clover POSTs {"verificationCode": "..."} when a webhook URL is first
  // registered (or changed) and expects it echoed back immediately, before
  // any signature/auth check.
  if (payload && typeof payload === "object" && "verificationCode" in payload) {
    return NextResponse.json({ verificationCode: payload.verificationCode }, { status: 200 });
  }

  const signature = request.headers.get(AUTH_HEADER);
  if (!isFromClover(signature)) {
    console.warn("[clover-webhook] rejected: bad auth header");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const events = extractEvents(payload);
  if (events.length === 0) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    for (const { merchantId, event } of events) {
      const objectId = event.objectId ?? "";
      const eventId = `${objectId}:${event.ts ?? Date.now()}`;
      // ON CONFLICT DO NOTHING is what makes retries/redelivery safe: the
      // same event_id arriving twice must produce at most one row.
      await sql`
        INSERT INTO raw_clover_events (event_id, event_type, merchant_id, payload)
        VALUES (
          ${eventId},
          ${event.type ?? "UNKNOWN"},
          ${merchantId},
          ${sql.json(event as never)}
        )
        ON CONFLICT (event_id) DO NOTHING
      `;
    }
  } catch (err) {
    // A 500 tells Clover to retry, which is what we want if the DB is down.
    console.error("[clover-webhook] db write failed", err);
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

/** Convenience: GET the endpoint in a browser to confirm it's deployed. */
export async function GET() {
  return NextResponse.json({ status: "clover webhook endpoint alive" });
}
