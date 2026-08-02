import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Square webhook receiver.
 *
 * Responsibilities, in order:
 *   1. Verify the request actually came from Square (HMAC-SHA256).
 *   2. Write the payload verbatim into raw_square_events.
 *   3. Return 200 fast.
 *
 * Deliberately does NOT parse orders into fact tables here. Square retries a
 * failed delivery up to 11 times over 24 hours, so this endpoint needs to be
 * quick and hard to break. Transformation happens later, reading from the raw
 * table -- which also means a parsing bug can be fixed and replayed rather
 * than losing the event.
 */

// Node runtime (not Edge): we need node:crypto and a TCP Postgres connection.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_HEADER = "x-square-hmacsha256-signature";

/**
 * Square signs the concatenation of the notification URL and the raw body --
 * not the body alone. NOTIFICATION_URL must match the subscription's URL in
 * the Square dashboard character for character, or every request fails
 * verification.
 */
function isFromSquare(rawBody: string, signature: string | null): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const url = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;

  if (!key || !url || !signature) return false;

  const expected = createHmac("sha256", key)
    .update(url + rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  // Constant-time compare: a plain === leaks timing information that can be
  // used to recover the key byte by byte.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull a location id out of whichever shape this event type uses. */
function extractLocationId(payload: Record<string, unknown>): string | null {
  const data = payload?.data as Record<string, unknown> | undefined;
  const object = data?.object as Record<string, unknown> | undefined;
  if (!object) return null;

  for (const key of ["order", "payment", "refund"]) {
    const entity = object[key] as Record<string, unknown> | undefined;
    if (entity && typeof entity.location_id === "string") {
      return entity.location_id;
    }
  }
  if (typeof object.location_id === "string") return object.location_id;
  return null;
}

export async function POST(request: NextRequest) {
  // Must read the raw text. Parsing to JSON and re-serializing changes the
  // bytes (key order, whitespace) and the signature will never match.
  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);

  if (!isFromSquare(rawBody, signature)) {
    console.warn("[square-webhook] rejected: bad signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventId = payload.event_id as string | undefined;
  const eventType = payload.type as string | undefined;
  const merchantId = (payload.merchant_id as string | undefined) ?? null;

  if (!eventId || !eventType) {
    return NextResponse.json({ error: "missing event_id or type" }, { status: 400 });
  }

  try {
    // ON CONFLICT DO NOTHING is what makes retries safe: Square may deliver
    // the same event_id many times, and each must produce at most one row.
    await sql`
      INSERT INTO raw_square_events (event_id, event_type, merchant_id, location_id, payload)
      VALUES (
        ${eventId},
        ${eventType},
        ${merchantId},
        ${extractLocationId(payload)},
        ${JSON.stringify(payload)}::jsonb
      )
      ON CONFLICT (event_id) DO NOTHING
    `;
  } catch (err) {
    // A 500 tells Square to retry, which is what we want if the DB is down.
    console.error("[square-webhook] db write failed", err);
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

/** Convenience: GET the endpoint in a browser to confirm it's deployed. */
export async function GET() {
  return NextResponse.json({ status: "square webhook endpoint alive" });
}