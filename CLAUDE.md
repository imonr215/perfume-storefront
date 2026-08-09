# perfume-storefront

Ecommerce storefront for a family-owned perfume and cologne business that
operates a physical mall kiosk. A QR code at the kiosk points customers here.

Dual purpose: a real business taking real orders, and a portfolio project
demonstrating data engineering and ML work. Both goals are real — don't
sacrifice correctness for demo polish, or vice versa.

Shop name is **Bloom & Basin**.

## Architecture

Square is the **system of record** for catalog, inventory, and payments. It
handles PCI compliance and money — card details are tokenized client-side by
the Web Payments SDK and never touch our server.

Supabase (Postgres) does **two separate jobs**, and it matters which is
which:

- **Storefront tables** (`store_*`): transactional, written **synchronously**
  by the Next.js app itself — accounts, sessions, carts, orders, addresses,
  wishlist. This is the live, authoritative data for "what did this customer
  order" and "what's in their cart right now."
- **Warehouse tables** (`dim_*`/`fact_*`): analytics/recommendation data,
  rebuilt **asynchronously** from Square webhooks by `etl/transform_events.py`.
  Product metadata (`dim_products` — scent family, notes, `square_variation_id`)
  lives here and is what checkout reads to re-validate prices/availability.

```
spreadsheet ──> Square catalog ──> webhooks ──> raw_square_events
                     │                              │
                     └──> dim_products <────────────┴──> fact_orders
                              │                          fact_line_items
                              │
                     web/app ──(reads)──┘
                        │
                        └──(writes synchronously)──> store_carts, store_orders,
                                                       store_customers, ...
```

Never conflate the two: checkout code writes `store_*` rows directly and
calls Square's API — it does not, and should not, write `fact_orders`/
`fact_line_items` itself. Those stay owned by the webhook → transform path.

## Layout

```
/etl                  Python: catalog import, product sync, event transform
  square_import.py      spreadsheet -> Square catalog + opening stock
  sync_products.py      spreadsheet + Square ids -> dim_products
  transform_events.py   raw_square_events -> fact tables
  apply_schema.py       applies schema.sql (idempotent, safe to re-run)
  schema.sql            both warehouse (dim_*/fact_*) and storefront (store_*) DDL
/web                  Next.js 16, App Router, TypeScript, Tailwind v4
  app/page.tsx           catalog grid: server-rendered search/filter/pagination,
                          no client JS required to browse
  app/scent/[sku]/       product detail — see page.tsx/scent-page.tsx gotcha below
  app/cart/, checkout/   DB-backed cart -> Square Orders + Payments API
  app/account/           login-gated: order history, addresses, wishlist
  app/login/, signup/    session-cookie auth (bcrypt, lockout after 5 attempts)
  app/terms/, privacy/,
    refunds/             legal pages
  app/api/webhooks/square/route.ts
  lib/cart.ts            cookie-identified DB cart; guest carts merge into the
                          account's cart on login/signup
  lib/auth.ts            sessions, password hashing, guest/account resolution
  lib/square.ts          Square client + order/payment/fulfillment builders
  lib/products.ts        product queries, filters, search
.env                  Python scripts read this (root)
web/.env.local        Next.js reads this (Next only reads its own directory)
```

Deployed on Vercel with **Root Directory set to `web`**.

## Conventions and hard-won gotchas

**SKU is always derived in Python (`make_sku()` in `etl/square_import.py`),
never read from the spreadsheet.** It strips all non-alphanumerics; the
sheet's own SKU formula only replaces spaces, so it keeps `&`, apostrophes,
periods, and accents. Trusting the sheet in one script and regenerating in
another has silently broken joins before. One function, used everywhere. The
sheet's SKU column is display-only.

**Webhook payloads must go in via `sql.json(payload as never)`.**
`JSON.stringify(...)::jsonb` compiles but double-encodes, storing a JSON
string scalar instead of an object, which breaks every JSONB query. Same
reasoning applies anywhere a JSONB column might get a JS `null` — pass a
real SQL `NULL` (`condition ? sql.json(obj) : null`), not `sql.json(null)`,
or an `IS NULL` check downstream will silently never match.

**Square order webhooks carry only a stub** — order_id, location_id, state,
version. No line items, totals, or customer. The transform has to call
`RetrieveOrder` to get the real thing.

**Raw-first is deliberate.** The webhook handler verifies the signature,
writes the payload verbatim, and returns 200 fast. Nothing is parsed at
receive time. Square retries up to 11 times over 24h, so the endpoint stays
hard to break, and a parsing bug can be fixed and replayed rather than
losing events.

**Webhook signature**: HMAC-SHA256 over `notification_url + raw_body`,
base64, in `x-square-hmacsha256-signature`. Must use the raw body
(re-serializing changes bytes) and constant-time comparison.
`SQUARE_WEBHOOK_NOTIFICATION_URL` must match the Square subscription exactly
or every request 401s.

**Idempotency everywhere.** `ON CONFLICT DO NOTHING` on raw events (retries),
`ON CONFLICT DO UPDATE`/upsert on facts (replays), idempotency keys on every
Square Orders/Payments API call. Scripts and checkout are both safe to retry.

**Don't use `instanceof SquareError` to catch Square API errors in Next
route handlers or Server Actions.** It fails silently under Next's
per-route/action bundling — a second copy of the `square` package ends up
loaded, so the thrown instance and the imported class aren't the same
identity, and every Square error (including plain card declines) falls
through to a generic catch-all instead of a real message. Use
`squareApiErrors(err)` from `lib/square.ts` instead — it duck-types the
response shape Square actually documents (`"errors" in err`), which is
robust to the bundling issue.

**`app/scent/[sku]/page.tsx` is a 4-line re-export shim, not the real
component** — the actual page lives in `scent-page.tsx` next to it. This is
deliberate (kept as a separate file from early on) and correct: Next's
router only recognizes a route from a file literally named `page.tsx`, so
the shim is what makes `/scent/[sku]` reachable at all. Don't "clean this
up" by inlining everything into `page.tsx`, and don't delete the shim.

**Run `npm run build` in /web before pushing.** Vercel treats lint and type
errors as build failures, and its log viewer truncates the error.

**Never commit secrets.** `.env` and `web/.env.local` are gitignored; only
`.env.example` / `web/.env.example` are tracked. Verify with `git status`
before pushing.

## Product images

Do NOT scrape or embed brand product photos or logos (Fragrantica, retailer
sites, brand marketing assets). They're copyrighted and trademarked, and
this is a live business — that's real exposure, not a hypothetical.
`app/components/bottle-glyph.tsx` draws an original flacon instead.

## Current state

**Working**: catalog import, warehouse schema, product sync, webhook
receiver, transform layer, storefront with server-rendered search/filter/
pagination, accounts (login/signup/sessions), address book, order history,
wishlist, guest + account checkout via Square (card payment, **pickup or
shipping fulfillment**), legal pages (Terms/Privacy/Refunds).

**Known gaps**:
- **No sales tax configured** on the Square location — orders total the
  line-item sum only. Business decision, not a code fix — set up in the
  Square dashboard when ready.
- **No shipping fee** — shipping and pickup currently cost the same
  (nothing extra). Deliberate for now; revisit if that's not the intent.
- Recommendation engine, owner analytics dashboard, and demand forecasting
  are not built.
- **Real inventory count** hasn't happened yet — catalog data (prices,
  quantities, barcodes) is placeholder, standing in until it does. Do that
  before any production Square cutover.
- No custom domain / QR code pointed at this deployment yet.

## Environment

Windows, VS Code, Python 3.13 (Microsoft Store build), Node v24. Activate
the venv before running Python: `.venv\Scripts\Activate.ps1`. Square Python
SDK v45 — note it was fully rewritten at v42, so most online examples
showing `Client(...)` are outdated; use `from square import Square`. Same
rewrite happened on the JS side (`square` npm package v45) — don't trust
older tutorials showing a different client shape there either.
