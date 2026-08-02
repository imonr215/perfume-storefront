# Perfume Inventory → Square Importer

ETL script that loads a fragrance inventory spreadsheet into Square's Catalog
and Inventory APIs. Groups rows into Square's `item → variation` model
(one item per brand + name + concentration, one variation per bottle size),
upserts the catalog, then sets opening stock per variation at a location.

Built against the **rewritten Square Python SDK (v42+)** — `from square import Square`.

## Setup
```bash
pip install -r requirements.txt
cp .env.example .env      # then paste your SANDBOX access token
```

## Run
```bash
# Build and inspect the API payload without any network calls
python square_import.py --file Perfume_Inventory_100.xlsx --dry-run

# Live import (start with SANDBOX credentials in .env)
python square_import.py --file Perfume_Inventory_100.xlsx
```

## Design notes
- **Idempotent** upserts and inventory changes (UUID idempotency keys) — safe to re-run.
- **Defensive validation**: rejects duplicate SKUs and missing prices before any API call.
- **Temp-id round-trip**: assigns client-side `#var_...` ids, then maps them to the
  real Square ids returned by `id_mappings` to attach inventory counts.
- **Catalog vs. recommendation data are separated by design.** Only sellable
  attributes (name, size, SKU, price, UPC, stock, shop blurb) go to Square. Scent
  metadata (family, note pyramid, gender) is reserved for the recommendation layer.

## Safety
- `.env` is git-ignored; never commit tokens.
- Test in **sandbox** first; the script warns loudly when `SQUARE_ENVIRONMENT=production`.
