# Perfumery at The Fashion District — storefront

Next.js (App Router) storefront: catalog browsing, cart, guest + account
checkout paid live on the kiosk's Clover Flex terminal via Remote Pay Cloud,
and a Clover webhook receiver that feeds the analytics warehouse in `../etl`.

## Setup
```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and the Clover vars
```

The database needs the warehouse + storefront schema applied once (from
`../etl`, with `DATABASE_URL` in `../.env`):
```bash
python apply_schema.py
```

## Run
```bash
npm run dev
```

## Notes
- `DATABASE_URL` should be Supabase's transaction pooler string (port 6543) —
  see `lib/db.ts`.
- `CLOVER_*` vars authorize server-side Platform API calls (`lib/clover.ts`).
  `CLOVER_API_TOKEN` must be a genuine OAuth `access_token` (see
  `app/api/webhooks/clover-oauth-capture/route.ts`) — the merchant
  dashboard's own "Platform API" token does not work for these calls,
  confirmed live.
- Checkout has **no card form at all**. `CLOVER_KIOSK_DEVICE_ID` /
  `CLOVER_REMOTE_APPLICATION_ID` / the OAuth access token are handed to
  `lib/clover-connector.ts`, a client component wrapping Clover's official
  `remote-pay-cloud` SDK, which opens its own WebSocket connection straight
  to the kiosk's Flex device. The customer taps/inserts their card there;
  card details never reach this app in any form. There's no sandbox
  simulator for this flow — it can only be proven end-to-end against real
  hardware.
- Pickup is the only fulfillment method — remote-pay only works when the
  customer is physically at the device, so shipping isn't offered.
- Customer accounts and cart/order tables (`store_*`) are transactional and
  written synchronously at checkout — separate from the `dim_*`/`fact_*`
  analytics tables in `../etl/schema.sql`, which are rebuilt asynchronously
  from Clover webhooks by `transform_events.py`.
