# Perfume Inventory → Clover Importer

ETL scripts that load a fragrance inventory spreadsheet into Clover's
Platform API catalog, sync scent metadata into the warehouse, and transform
Clover webhook events into the analytics fact tables. See `../CLAUDE.md` for
the full architecture.

Built against Clover's Platform API directly (`etl/clover_client.py`) --
there's no official Clover Python SDK, confirmed while building this.

## Setup
```bash
pip install -r etl/requirements.txt
cp .env.example .env
```

`.env` needs `CLOVER_MERCHANT_ID` and `CLOVER_API_TOKEN` -- the latter must
be a genuine OAuth `access_token` (see
`web/app/api/webhooks/clover-oauth-capture/route.ts` for how to get one;
the merchant dashboard's own "Platform API" token does not work for these
calls, confirmed live).

## Run
```bash
cd etl

# Build and inspect the catalog plan without any network calls
python clover_import.py --file Perfume_Inventory_Real.xlsx --dry-run

# Live import (sandbox merchant first, always)
python clover_import.py --file Perfume_Inventory_Real.xlsx

# Pull scent metadata + Clover catalog ids into the warehouse
python sync_products.py --file Perfume_Inventory_Real.xlsx

# Process the webhook backlog into fact_orders / fact_line_items
python transform_events.py
```

## Design notes
- **Idempotent**: re-running `clover_import.py` skips item groups/items that
  already exist by name/SKU rather than duplicating them -- Clover's
  Platform API has no batch-upsert/idempotency-key concept the way Square's
  catalog API did, so check-then-create is the mechanism here instead.
- **Defensive validation**: rejects duplicate SKUs and missing prices before
  any API call.
- **Catalog vs. recommendation data are separated by design.** Only
  sellable attributes (name, size, SKU, price, UPC, stock) go to Clover.
  Scent metadata (family, note pyramid, gender) is reserved for the
  recommendation layer in the warehouse.

## Safety
- `.env` is git-ignored; never commit tokens.
- Test in **sandbox** first, always. Scripts that touch a merchant's
  catalog (`clover_import.py`, `reset_catalog.py`) don't have a
  Square-style automatic production warning baked in from `CLOVER_ENVIRONMENT`
  the same way the old scripts did for `SQUARE_ENVIRONMENT` -- double check
  `CLOVER_MERCHANT_ID` by hand before running against anything but the
  sandbox test merchant. Never run against the live kiosk merchant without
  explicit owner sign-off (see the migration plan's Phase 7).
