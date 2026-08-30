# perfume-storefront

Ecommerce storefront for a family-owned perfume and cologne business that
operates a physical mall kiosk. A QR code at the kiosk points customers here.

Dual purpose: a real business taking real orders, and a portfolio project
demonstrating data engineering and ML work. Both goals are real — don't
sacrifice correctness for demo polish, or vice versa.

Shop name is **Perfumery at The Fashion District** (was **Bloom & Basin**
until 2026-08-30 — some historical commit messages/branch names predate the
rename and still say the old name).

## Architecture

Clover is the **system of record** for catalog, inventory, and payments.
The kiosk already runs a physical Clover Flex terminal for in-person sales;
**online orders pay on that same terminal**, live, via Clover's Remote Pay
Cloud SDK — the customer checks out on the site, the sale is sent to the
kiosk's Flex, and they tap/insert their card right there. Card details
never reach this app in any form; there's no online card entry at all.
Pickup is therefore the only fulfillment method — remote-pay only works
when the customer is physically at the device, so shipping isn't offered.

This is a deliberate simplification over a more Square-like model: because
every payment (online-initiated or walk-up) settles through the *same*
physical device and the *same* Platform API, there's only **one** webhook
stream and **one** event shape to reason about — no separate
"ecommerce API" surface with its own credentials/webhooks to keep in sync.
(Clover does have a separate online-only Ecommerce API for card
tokenization, but it turned out to have a genuine backend provisioning gap
on this account — confirmed via a properly OAuth-issued, merchant-verified
key still getting "No Merchant found" from its config endpoint — and isn't
used here at all.)

Supabase (Postgres) does **two separate jobs**, and it matters which is
which:

- **Storefront tables** (`store_*`): transactional, written **synchronously**
  by the Next.js app itself — accounts, sessions, carts, orders, addresses,
  wishlist. This is the live, authoritative data for "what did this customer
  order" and "what's in their cart right now."
- **Warehouse tables** (`dim_*`/`fact_*`): analytics/recommendation data,
  rebuilt **asynchronously** from Clover webhooks by `etl/transform_events.py`.
  Product metadata (`dim_products` — scent family, notes, `clover_variation_id`)
  lives here and is what checkout reads to re-validate prices/availability.

```
spreadsheet ──> Clover catalog ──> webhooks ──> raw_clover_events
                     │                              │
                     └──> dim_products <────────────┴──> fact_orders
                              │                          fact_line_items
                              │
                     web/app ──(reads)──┘
                        │
                        ├──(pays live)──> kiosk's Flex device (Remote Pay Cloud)
                        │
                        └──(writes synchronously)──> store_carts, store_orders,
                                                       store_customers, ...
```

Never conflate the two: checkout code writes `store_*` rows directly and
pays via the Flex device — it does not, and should not, write `fact_orders`/
`fact_line_items` itself. Those stay owned by the webhook → transform path.

## Layout

```
/etl                  Python: catalog import, product sync, event transform
  clover_client.py       shared Clover Platform API client (auth/host gotchas below)
  clover_import.py       spreadsheet -> Clover item groups/items + opening stock
  sync_products.py       spreadsheet + Clover ids -> dim_products
  transform_events.py    raw_clover_events -> fact tables
  reset_catalog.py       wipes a merchant's catalog (dev tool, production-guarded)
  create_test_order.py   places a real sandbox order to trigger a genuine webhook
  apply_schema.py        applies schema.sql (idempotent, safe to re-run)
  schema.sql              both warehouse (dim_*/fact_*) and storefront (store_*) DDL
/web                  Next.js 16, App Router, TypeScript, Tailwind v4
  app/page.tsx           catalog grid: server-rendered search/filter/pagination,
                          no client JS required to browse
  app/scent/[sku]/       product detail — see page.tsx/scent-page.tsx gotcha below
  app/cart/, checkout/   DB-backed cart -> pays live on the kiosk's Flex device
  app/account/           login-gated: order history, addresses, wishlist
  app/login/, signup/    session-cookie auth (bcrypt, lockout after 5 attempts)
  app/terms/, privacy/,
    refunds/             legal pages
  app/api/webhooks/clover/route.ts
  app/api/webhooks/clover-oauth-capture/route.ts
                          setup utility: exchanges an OAuth code for the access
                          token CLOVER_API_TOKEN / Remote Pay Cloud need
  lib/cart.ts            cookie-identified DB cart; guest carts merge into the
                          account's cart on login/signup
  lib/auth.ts            sessions, password hashing, guest/account resolution
  lib/clover.ts          Clover Platform API client (server-side REST calls)
  lib/clover-connector.ts
                          client component wrapping Clover's official
                          remote-pay-cloud SDK -- what actually pays for an order
  lib/products.ts        product queries, filters, search
  types/remote-pay-cloud-shim.ts, types/remote-pay-cloud-index.d.ts
                          type-checker workaround for that package's broken
                          shipped types -- see gotchas below before touching
.env                  Python scripts read this (root)
web/.env.local        Next.js reads this (Next only reads its own directory)
```

Deployed on Vercel with **Root Directory set to `web`**.

## Conventions and hard-won gotchas

**SKU is always derived in Python (`make_sku()` in `etl/sku.py`), never read
from the spreadsheet.** Format is `BRAND-NAME-CONCENTRATION-SIZE` —
concentration was added after the real inventory count surfaced products
that differ only by concentration (e.g. Lacoste L.12.12 Blanc EDT vs. EDP,
same size, same price, genuinely different products); the old
`BRAND-NAME-SIZE` scheme collapsed those to one SKU. Concentration is the
one optional segment, skipped (not left as an empty segment) when blank —
a blank cell comes through pandas as NaN/None, and `str(nan)` is the
literal text `"nan"`, so it's checked for explicitly rather than slugged
in. `make_sku()` strips all non-alphanumerics; the sheet's own SKU formula
only replaces spaces, so it keeps `&`, apostrophes, periods, and accents.
`etl/clover_import.py`, `etl/sync_products.py`, and
`etl/generate_descriptions.py` all import `make_sku()` from `etl/sku.py`
rather than reimplementing it — three independent copies drifting apart
(once cost 21 of 100 products their join) is exactly the failure mode a
single shared function exists to prevent. The sheet's SKU column is
display-only.

**Clover's actual working host is `api.clover.com` (production), even for
a sandbox test merchant — `sandbox.dev.clover.com` doesn't work at all on
this account.** Confirmed live, repeatedly, the hard way: every call tried
against `sandbox.dev.clover.com` (Platform API reads, item-group creation,
OAuth authorize/token) returned a clean 401 or 404, while the identical
call against `api.clover.com`/`www.clover.com` succeeded. This contradicts
what most of Clover's own docs describe for sandbox development — don't
"fix" `etl/clover_client.py` or `web/lib/clover.ts` back to the sandbox
host without re-confirming against a real call first, docs alone got this
wrong here.

**The merchant dashboard's own "Platform API" token does not work — use a
genuine OAuth `access_token` instead.** Generating a token from a test
merchant's own Setup → API Tokens page (the natural-looking, documented
"merchant-specific token" path for a single-merchant integration) produces
a token that 401s on every Platform API call, including a plain `GET` of
the merchant object itself. What actually works: the full OAuth
authorization-code flow — authorize at
`https://www.clover.com/oauth/authorize?client_id={APP_ID}` (the **legacy**
path; Clover's own "Example OAuth Request" for a real registered app
confirmed this, not `sandbox.dev.clover.com/oauth/v2/authorize`, which
crashed/blanked in this account's browser session) → exchange the code
immediately at `https://api.clover.com/oauth/token` (also legacy path,
production host — not `apisandbox.dev.clover.com/oauth/v2/token`, which
404s) → the resulting `access_token` is what `CLOVER_API_TOKEN` (and Remote
Pay Cloud's `accessToken` param) must actually be.
`app/api/webhooks/clover-oauth-capture/route.ts` automates this exchange.

**Clover's OAuth authorization codes expire within seconds** — fast enough
that a human copy-pasting the redirect URL to complete the exchange
manually reliably fails with `{"message":"Failed to validate authentication
code."}`. The code must be exchanged the instant the browser lands on the
redirect (`clover-oauth-capture/route.ts`'s whole reason for existing),
not relayed by hand.

**Clover's Platform catalog model has no single "variation" object the way
Square's did.** Verified live, not guessed from docs: creating a
size-variant catalog requires `item_groups` (the product family, e.g.
"Dior Sauvage EDT") → an `attributes` record named "Size" scoped to that
group → one `attributes/{id}/options` per distinct size → an `items` record
per size (carrying `sku`/`price`/`itemGroup:{id}`) → a separate
`option_items` call linking each item to its size option. Also confirmed
live: `GET /item_groups/{id}/attributes` is a genuine 405 despite looking
like the obvious way to list a group's attributes — `GET /item_groups?
expand=attributes` is what actually works, and gets every group's
attribute in one call instead of one per group. Stock is set via
`POST /item_stocks/{itemId}` with `{"quantity": N}`. `dim_products.clover_item_id`
holds the item_group id (shared across sizes); `clover_variation_id` holds
the individual item id (unique per SKU) — this is what `fact_line_items`
joins against.

**Webhook payloads must go in via `sql.json(payload as never)`.**
`JSON.stringify(...)::jsonb` compiles but double-encodes, storing a JSON
string scalar instead of an object, which breaks every JSONB query. Same
reasoning applies anywhere a JSONB column might get a JS `null` — pass a
real SQL `NULL` (`condition ? sql.json(obj) : null`), not `sql.json(null)`,
or an `IS NULL` check downstream will silently never match.

**Clover order/payment webhooks carry only a stub.** The body is
`{"merchants": {merchantId: [{"objectId": "O:xyz", "type": "CREATE", "ts":
...}, ...]}}` — an event-category prefix (`O:` orders, `P:` payments, `I:`
inventory, `C:` customers) plus an id, no line items or totals. The
transform has to fetch the real object. Unlike Square, **a single delivery
can bundle multiple events** for multiple objects in one POST — the insert
loop in `app/api/webhooks/clover/route.ts` and the processing loop in
`transform_events.py` both iterate per-event, not per-request.

**Raw-first is deliberate.** The webhook handler verifies the auth header,
writes every event verbatim, and returns 200 fast. Nothing is parsed at
receive time — a parsing bug can be fixed and replayed rather than losing
events.

**Webhook auth is a static header, not a computed signature.** Clover sends
a fixed shared secret (the app's own App Secret) in the `X-Clover-Auth`
header on every delivery — compare it against `CLOVER_WEBHOOK_AUTH_CODE`
with a constant-time compare (still worth doing even though it's not an
HMAC, since it's a secret-bearing header). Registering or changing a
webhook URL also triggers a one-time `{"verificationCode": "..."}`
challenge that must be echoed back before the static-header check ever
applies — handled as its own branch at the top of the route.

**Idempotency everywhere.** `ON CONFLICT DO NOTHING` on raw events
(retries), `ON CONFLICT DO UPDATE`/upsert on facts (replays). Clover's
Platform API has **no batch-upsert/idempotency-key concept** the way
Square's catalog API did — `clover_import.py`'s idempotency is
check-then-create (fetch existing item groups/items by name/SKU first,
skip what's already there) rather than a server-side dedup key.

**Don't use `instanceof` to catch Clover API errors in Next route handlers
or Server Actions.** Same Next.js per-route/action bundling hazard
documented for the old Square integration — a hand-rolled error class
would hit the identical problem. `cloverApiErrors(err)` in `lib/clover.ts`
duck-types the response shape instead.

**`remote-pay-cloud`'s own shipped TypeScript types are broken** — its
published `types/index.d.ts` re-exports directly from the package's raw,
uncompiled `.ts` source tree rather than compiled declarations, and that
source tree fails this project's strict-mode settings the moment anything
imports the package at all. Fixed via a `paths` remap in `tsconfig.json`
(`"remote-pay-cloud": ["./types/remote-pay-cloud-shim.ts"]`) pointing at a
local shim. **That shim must do a genuine runtime re-export, not just a
type declaration** — confirmed live that Next's bundler (Turbopack) honors
tsconfig `paths` for actual module resolution too, not only the
type-checker; an earlier `declare const cloverSdk: any` version compiled
fine but threw `ReferenceError: cloverSdk is not defined` at runtime the
moment the real page loaded. The shim instead imports the package's real
entry via an explicit subpath (`remote-pay-cloud/index.js`, covered by a
one-line `declare module` in `types/remote-pay-cloud-index.d.ts` since
subpath imports don't consult the package's broken `types` field). Don't
"simplify" this back to a plain ambient `declare module "remote-pay-cloud"
{}` — confirmed live that doesn't override an already-resolvable real
package's own types the way it would for a genuinely typeless one.

**`app/scent/[sku]/page.tsx` is a 4-line re-export shim, not the real
component** — the actual page lives in `scent-page.tsx` next to it. This is
deliberate (kept as a separate file from early on) and correct: Next's
router only recognizes a route from a file literally named `page.tsx`, so
the shim is what makes `/scent/[sku]` reachable at all. Don't "clean this
up" by inlining everything into `page.tsx`, and don't delete the shim.

**Supabase's transaction-mode pooler doesn't support server-side prepared
statements — this bites both the Node and Python sides.** On the Node side
`lib/db.ts` sets `prepare: false` on the `postgres()` client. On the Python
side, confirmed live in `etl/sync_fraganty_images.py`: `psycopg` auto-
prepares a repeated parameterized query after 5 uses by default, and the
6th+ use failed with `psycopg.errors.InvalidSqlStatementName: prepared
statement "_pg3_0" does not exist` once the pooler routed a later request
to a different backend connection than the one that prepared it. Any script
that runs the same query shape in a loop needs
`psycopg.connect(url, prepare_threshold=None)`. `apply_schema.py` never hit
this because it runs schema.sql as one single statement, not a repeated one
-- don't assume that pattern generalizes to new scripts.

**This dev machine's Python can't verify some real HTTPS certs that curl
verifies fine.** Confirmed against fraganty.ai, Square's API (historical),
and Clover's API: `CERTIFICATE_VERIFY_FAILED` / `unable to get local issuer
certificate`, from Python's `ssl` module either via the Windows cert store
or a static `certifi` bundle. Windows' native TLS stack (what curl uses
here) fetches a missing intermediate cert on the fly via AIA chaining;
Python's OpenSSL binding doesn't do that by default. The durable fix is
`truststore` (`truststore.inject_into_ssl()` before any HTTPS client is
created -- see `etl/clover_client.py`), which patches `ssl` to use the OS's
own verification instead. Prefer that over another one-off curl-shim per
script; `etl/sync_fraganty_images.py` predates this fix and shells out to
curl instead, which still works but isn't the pattern to copy going
forward.

**Run `npm run build` in /web before pushing.** Vercel treats lint and type
errors as build failures, and its log viewer truncates the error.

**Never commit secrets.** `.env` and `web/.env.local` are gitignored; only
`.env.example` / `web/.env.example` are tracked. Verify with `git status`
before pushing.

## Product images

Do NOT scrape or embed brand product photos or logos from unlicensed
sources (Fragrantica, retailer sites, brand marketing assets, or fraganty.ai
outside the exception below). They're copyrighted and trademarked, and this
is a live business — that's real exposure, not a hypothetical.
`app/components/bottle-glyph.tsx` draws an original flacon instead.

**Exception: fraganty.ai paid API tier.** As of 2026-08-09, Perfumery at
The Fashion District (subscribed under its prior name, Bloom & Basin —
same account, unaffected by the rename) holds a paid fraganty.ai API
subscription. Per terms at https://fraganty.ai/terms (Subscriber = the
shop, under whichever name it held when the subscription was opened), the
Paid API tier
carries a worldwide, sublicensable license to commercially distribute Data
Assets — explicitly including product photography and brand imagery —
retrieved through it, backed by fraganty.ai's own ownership/sourcing
warranty and third-party-IP indemnification. Free/Trial tier access is
non-commercial-only under the same terms, so this does not extend to
unauthenticated or free-tier use of their data. Images fetched from
`img.fraganty.ai` via the paid API (`X-API-Key` header) are therefore fine
to use as real product photos, in place of or alongside BottleGlyph.

Caveat worth keeping attached to this: fraganty.ai blocks automated access
(Cloudflare challenge) on both the marketing site and the terms page
itself, so this was never independently verified against the live page —
it rests on the business owner's own confirmation, not on Claude having
read the terms directly. If the subscription lapses, or the terms change,
this exception no longer holds without re-verifying it.

## Current state

**Working**: catalog import, warehouse schema, product sync, webhook
receiver, transform layer, storefront with server-rendered search/filter/
pagination, accounts (login/signup/sessions), address book, order history,
wishlist, guest + account checkout with payment taken live on the kiosk's
Clover Flex terminal via Remote Pay Cloud (**pickup only**), legal pages
(Terms/Privacy/Refunds).

**Known gaps**:
- **Remote Pay Cloud has no sandbox simulator** — confirmed via Clover's
  own community/docs. Everything up through opening the WebSocket
  connection is exercisable in sandbox; the actual `sale()` round trip
  (tap card → payment result) can only be proven against real hardware (a
  purchased Clover Dev Kit, or the live kiosk Flex under an explicit,
  owner-supervised test). Don't treat a clean `npm run build` or a
  successful sandbox page load as proof this actually charges a card —
  it isn't, by construction.
- **Shipping fulfillment was removed.** Pickup-only for now, since
  remote-pay requires the customer to be physically at the kiosk device.
  Revisit if a separate online-payment path (e.g. once Clover's Ecommerce
  API provisioning gap is resolved) gets added back.
- **No sales tax configured** on the Clover merchant — orders total the
  line-item sum only. Business decision, not a code fix.
- Recommendation engine, owner analytics dashboard, and demand forecasting
  are not built.
- **Real inventory count** hasn't happened yet for the full catalog —
  price/quantity/barcode data for most products is still placeholder.
  `clover_import.py` has been run against the sandbox for the real subset
  that does exist; the rest needs the same treatment before any production
  cutover.
- **Production cutover to the live kiosk merchant hasn't happened.**
  Everything above runs against a sandbox test merchant. Flipping
  `CLOVER_ENVIRONMENT`/`CLOVER_MERCHANT_ID`/`CLOVER_API_TOKEN` to live
  values, registering the live webhook, and deciding whether to backfill
  the kiosk's pre-migration transaction history are separate, deliberate,
  owner-gated steps — not something to do as a side effect of another
  change. For reference only, not yet used anywhere in code: the real
  kiosk's Flex shows Merchant ID `373346753991` (a plain numeric id — a
  different format from the alphanumeric sandbox test-merchant ids used
  throughout this migration) and Terminal# `4445842`, logged into the
  business's real Clover account ("Imon Jewels and Treasure").
- `classify_channel()` in `etl/transform_events.py` is a best-effort
  placeholder pending a real remote-pay order to inspect (see that
  function's docstring) — a live test order created directly via the
  Platform REST API always carried an `employee` field matching the
  account owner regardless of who actually initiated it, so
  employee-presence turned out not to be a usable signal the way it was
  first assumed to be.
- No custom domain / QR code pointed at this deployment yet.

## Environment

Windows, VS Code, Python 3.13 (Microsoft Store build), Node v24. Activate
the venv before running Python: `.venv\Scripts\Activate.ps1`. No official
Clover SDK exists for either Python or Node (confirmed) — `etl/clover_client.py`
and `web/lib/clover.ts` are both hand-rolled thin REST clients rather than
third-party dependencies. The one exception is `remote-pay-cloud`
(`web/lib/clover-connector.ts`), which **is** Clover's own official
JavaScript SDK for the device-payment WebSocket protocol — see that file
and the gotchas above for its broken shipped types and the tsconfig
workaround needed to build with it at all.
