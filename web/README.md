# Maple & Musk — storefront

Next.js (App Router) storefront: catalog browsing, cart, guest + account
checkout via Square's Web Payments SDK, and a Square webhook receiver that
feeds the analytics warehouse in `../etl`.

## Setup
```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and the Square vars
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
- `SQUARE_*` vars authorize server-side Orders/Payments/Customers API calls
  (`lib/square.ts`); `NEXT_PUBLIC_SQUARE_*` vars are shipped to the browser so
  the Web Payments SDK can render the card form. Card details are tokenized
  client-side and never touch this server.
- Customer accounts and cart/order tables (`store_*`) are transactional and
  written synchronously at checkout — separate from the `dim_*`/`fact_*`
  analytics tables in `../etl/schema.sql`, which are rebuilt asynchronously
  from Square webhooks by `transform_events.py`.
