"""
sync_products.py -- populate dim_products from the inventory spreadsheet,
enriched with the Square catalog ids.

Why both sources: the spreadsheet holds the scent attributes that Square has no
field for (family, note pyramid, gender) and that the recommender runs on. Square
holds the authoritative variation/item ids that order webhooks will reference.
dim_products is where the two meet, so a line item can join to a scent profile.

Matching is on SKU, which is why the SKU scheme (BRAND-NAME-SIZE) is generated
identically on both sides.

Usage:
    python sync_products.py --file Perfume_Inventory_100.xlsx
    python sync_products.py --file Perfume_Inventory_100.xlsx --dry-run
"""

import argparse
import os
import re
import sys

import pandas as pd
import psycopg
import truststore
from dotenv import load_dotenv

# This machine's Python/OpenSSL doesn't do the AIA chasing that Windows'
# native TLS stack (what curl uses) does to fetch a missing intermediate
# cert -- confirmed live as CERTIFICATE_VERIFY_FAILED against Square's API,
# same underlying issue as the one documented for etl/sync_fraganty_images.py
# in root CLAUDE.md. truststore patches ssl to use the OS's own certificate
# verification instead of a static bundle, which is the real fix (not
# another one-off curl shim) since every Python HTTPS call on this machine
# hits the same problem, not just this script's.
truststore.inject_into_ssl()

SHEET_NAME = "Inventory"
HEADER_ROW = 1


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def slug(text) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", str(text).upper()).strip("-")


def parse_notes(value):
    """'Bergamot, Pepper' -> ['Bergamot', 'Pepper']; blank -> []."""
    if pd.isna(value) or not str(value).strip():
        return []
    return [n.strip() for n in str(value).split(",") if n.strip()]


def to_cents(value):
    if pd.isna(value):
        return None
    return int(round(float(value) * 100))


def clean(value):
    if pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #
def load_sheet(path: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=SHEET_NAME, header=HEADER_ROW)
    df.columns = [c.strip() for c in df.columns]
    df = df[df["Brand"].notna() & df["Product Name"].notna() & df["Size"].notna()].copy()
    df["SKU"] = df.apply(
        lambda r: slug(f"{r['Brand']}-{r['Product Name']}-{r['Size']}"), axis=1
    )
    return df.reset_index(drop=True)


def fetch_square_ids() -> dict:
    """Return {sku: (item_id, variation_id)} for everything in the Square catalog."""
    from square import Square
    from square.environment import SquareEnvironment

    token = os.environ.get("SQUARE_ACCESS_TOKEN")
    if not token:
        sys.exit("SQUARE_ACCESS_TOKEN is not set in .env")
    env_name = os.environ.get("SQUARE_ENVIRONMENT", "sandbox").lower()
    env = SquareEnvironment.PRODUCTION if env_name == "production" else SquareEnvironment.SANDBOX
    client = Square(environment=env, token=token)

    mapping = {}
    for obj in client.catalog.list(types="ITEM"):
        item_data = getattr(obj, "item_data", None)
        if not item_data:
            continue
        for var in getattr(item_data, "variations", None) or []:
            vdata = getattr(var, "item_variation_data", None)
            if not vdata:
                continue
            sku = getattr(vdata, "sku", None)
            if sku:
                mapping[sku] = (obj.id, var.id)
    return mapping


# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #
UPSERT = """
INSERT INTO dim_products (
    sku, square_item_id, square_variation_id,
    brand, product_name, concentration, size,
    price_cents, cost_cents,
    scent_family, top_notes, heart_notes, base_notes, gender, description,
    updated_at
) VALUES (
    %(sku)s, %(item_id)s, %(variation_id)s,
    %(brand)s, %(product_name)s, %(concentration)s, %(size)s,
    %(price_cents)s, %(cost_cents)s,
    %(scent_family)s, %(top_notes)s, %(heart_notes)s, %(base_notes)s,
    %(gender)s, %(description)s,
    now()
)
ON CONFLICT (sku) DO UPDATE SET
    square_item_id      = COALESCE(EXCLUDED.square_item_id, dim_products.square_item_id),
    square_variation_id = COALESCE(EXCLUDED.square_variation_id, dim_products.square_variation_id),
    brand               = EXCLUDED.brand,
    product_name        = EXCLUDED.product_name,
    concentration       = EXCLUDED.concentration,
    size                = EXCLUDED.size,
    price_cents         = EXCLUDED.price_cents,
    cost_cents          = EXCLUDED.cost_cents,
    scent_family        = EXCLUDED.scent_family,
    top_notes           = EXCLUDED.top_notes,
    heart_notes         = EXCLUDED.heart_notes,
    base_notes          = EXCLUDED.base_notes,
    gender              = EXCLUDED.gender,
    description         = EXCLUDED.description,
    updated_at          = now()
"""


def build_rows(df: pd.DataFrame, square_ids: dict):
    rows, unmatched = [], []
    for _, r in df.iterrows():
        sku = r["SKU"]
        item_id, variation_id = square_ids.get(sku, (None, None))
        if variation_id is None:
            unmatched.append(sku)
        rows.append({
            "sku": sku,
            "item_id": item_id,
            "variation_id": variation_id,
            "brand": clean(r["Brand"]),
            "product_name": clean(r["Product Name"]),
            "concentration": clean(r.get("Concentration")),
            "size": clean(r["Size"]),
            "price_cents": to_cents(r.get("Price ($)")),
            "cost_cents": to_cents(r.get("Cost ($)")),
            "scent_family": clean(r.get("Scent Family")),
            "top_notes": parse_notes(r.get("Top Notes")),
            "heart_notes": parse_notes(r.get("Heart Notes")),
            "base_notes": parse_notes(r.get("Base Notes")),
            "gender": clean(r.get("Gender")),
            "description": clean(r.get("Description (optional)")),
        })
    return rows, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    load_dotenv()

    df = load_sheet(args.file)
    print(f"Sheet: {len(df)} products.")

    print("Fetching Square catalog ids...")
    square_ids = fetch_square_ids()
    print(f"Square: {len(square_ids)} variations with SKUs.")

    rows, unmatched = build_rows(df, square_ids)
    matched = len(rows) - len(unmatched)
    print(f"Matched {matched}/{len(rows)} products to Square variation ids.")
    if unmatched:
        print(f"  unmatched: {', '.join(unmatched[:5])}"
              + (f" ... (+{len(unmatched) - 5})" if len(unmatched) > 5 else ""))

    if args.dry_run:
        print("\nDry run -- sample row:")
        for k, v in rows[0].items():
            print(f"  {k}: {v}")
        return

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set in .env")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT, rows)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COUNT(square_variation_id) FROM dim_products")
            total, linked = cur.fetchone()
    print(f"\ndim_products: {total} rows, {linked} linked to Square.")


if __name__ == "__main__":
    main()
