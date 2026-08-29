import { NextRequest, NextResponse } from "next/server";

/**
 * THROWAWAY spike endpoint -- not the real Clover webhook receiver.
 *
 * Purpose: unblock the Phase 0/Phase 1 sandbox spike (see the Square->Clover
 * migration plan) before the real receiver exists. It does two things:
 *   1. Echoes back Clover's one-time `{"verificationCode": "..."}` challenge
 *      so the webhook subscription can be registered at all.
 *   2. Logs every other delivery verbatim (headers + body) to stdout, so we
 *      can inspect in Vercel's function logs whether an Ecommerce charge
 *      produces a Platform Order/Payment event, and what shape it's in.
 *
 * No signature verification, no DB write, no raw_clover_events table --
 * those all show up in the real app/api/webhooks/clover/route.ts (Phase 4),
 * once the spike's findings settle which webhook architecture (Design A vs
 * B) that route needs to implement. Delete this file once Phase 4 lands.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[clover-spike] non-JSON body:", rawBody);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (
    payload &&
    typeof payload === "object" &&
    "verificationCode" in payload
  ) {
    const code = (payload as { verificationCode: unknown }).verificationCode;
    console.log("[clover-spike] verification challenge, echoing back:", code);
    return NextResponse.json({ verificationCode: code }, { status: 200 });
  }

  console.log("[clover-spike] delivery received --", {
    headers: Object.fromEntries(request.headers.entries()),
    payload,
  });

  return NextResponse.json({ received: true }, { status: 200 });
}

/** Convenience: GET the endpoint in a browser to confirm it's deployed. */
export async function GET() {
  return NextResponse.json({ status: "clover spike webhook endpoint alive" });
}
