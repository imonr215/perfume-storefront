import { NextRequest, NextResponse } from "next/server";

/**
 * THROWAWAY spike endpoint -- captures and immediately exchanges an OAuth
 * authorization code the instant the browser lands here (as Clover's
 * "Alternate Launch Path" redirect target), eliminating the human
 * copy-paste latency that was causing "Failed to validate authentication
 * code" (codes appear to expire within seconds).
 *
 * Delete once Phase 1's spike concludes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_ID = "0N4CS06MCZ8JR";
const CLIENT_SECRET = "1787bb98-80cf-a9e6-9845-f97bc89eeb91";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const merchantId = request.nextUrl.searchParams.get("merchant_id");

  if (!code) {
    return NextResponse.json(
      { received: request.nextUrl.searchParams.toString(), note: "no code param present" },
      { status: 200 }
    );
  }

  const start = Date.now();
  try {
    const resp = await fetch("https://apisandbox.dev.clover.com/oauth/v2/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }),
    });
    const body = await resp.text();
    const elapsedMs = Date.now() - start;

    return NextResponse.json(
      { merchantId, exchangeStatus: resp.status, exchangeBody: body, elapsedMs },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 200 }
    );
  }
}
