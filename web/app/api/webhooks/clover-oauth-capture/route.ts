import { NextRequest, NextResponse } from "next/server";

/**
 * OAuth code-capture endpoint -- the "Alternate Launch Path" redirect target
 * registered in the Clover app's REST Configuration.
 *
 * Not a checkout-flow route -- this is a one-time (or occasional)
 * setup/admin utility for obtaining the OAuth access_token that
 * CLOVER_API_TOKEN and Remote Pay Cloud's accessToken param both need.
 * Visit the authorize URL in a browser while logged into the target
 * merchant's Clover dashboard:
 *
 *   https://www.clover.com/oauth/authorize?client_id={CLOVER_APP_ID}
 *
 * ...select the merchant, and Clover redirects here with `?code=...`. This
 * route exchanges it immediately, server-side, the instant the browser
 * lands -- Clover's authorization codes expire within seconds, too fast for
 * a human copy-paste round trip (confirmed live: two separate codes both
 * failed exchange with "Failed to validate authentication code" after
 * being manually relayed).
 *
 * Two hard-won host/path facts, confirmed live against this account, that
 * contradict what Clover's own newer v2/OAuth docs describe:
 *   - The authorize URL is the legacy `www.clover.com/oauth/authorize`
 *     (Clover's own "Example OAuth Request" for this app confirmed this),
 *     NOT `sandbox.dev.clover.com/oauth/v2/authorize`, which returned a
 *     blank/crashing page in this account's browser session.
 *   - The token exchange is `api.clover.com/oauth/token` (production host,
 *     legacy path), NOT `apisandbox.dev.clover.com/oauth/v2/token`, which
 *     404s.
 * The resulting access_token then works against `api.clover.com/v3/...`
 * for every Platform API call -- also confirmed live, including for a
 * sandbox test merchant. sandbox.dev.clover.com 401'd on every call tried,
 * with any credential.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const merchantId = request.nextUrl.searchParams.get("merchant_id");

  if (!code) {
    return NextResponse.json(
      { received: request.nextUrl.searchParams.toString(), note: "no code param present" },
      { status: 200 }
    );
  }

  const clientId = process.env.CLOVER_APP_ID;
  const clientSecret = process.env.CLOVER_APP_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "CLOVER_APP_ID / CLOVER_APP_SECRET not set" },
      { status: 500 }
    );
  }

  try {
    const resp = await fetch("https://api.clover.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const body = await resp.text();

    return NextResponse.json(
      {
        merchantId,
        exchangeStatus: resp.status,
        exchangeBody: body,
        note: "Copy the access_token above into CLOVER_API_TOKEN (and CLOVER_OAUTH_ACCESS_TOKEN if kept separate).",
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 200 });
  }
}
