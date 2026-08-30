"""
sync_products.py -- populate dim_products from the inventory spreadsheet,
enriched with the Clover catalog ids.

Why both sources: the spreadsheet holds the scent attributes that Clover has
no field for (family, note pyramid, gender) and that the recommender runs
on. Clover holds the authoritative item/item-group ids that order webhooks
will reference. dim_products is where the two meet, so a line item can join
to a scent profile.

Matching is on SKU, which is why the SKU scheme (BRAND-NAME-CONCENTRATION-SIZE)
is generated identically on both sides.

Clover's catalog model has no single "variation" object the way Square
does -- each size is its own top-level item, grouped under an item_group
(see clover_import.py). dim_products.clover_item_id holds the item_group's
id (shared across every size of the same fragrance);
dim_products.clover_variation_id holds the individual item's id (unique per
SKU/size) -- this is what fact_line_items joins against.

Usage:
    python sync_products.py --file Perfume_Inventory_Real.xlsx
    python sync_products.py --file Perfume_Inventory_Real.xlsx --dry-run
"""

import argparse
import os
import sys

import pandas as pd
import psycopg
from dotenv import load_dotenv

from clover_client import get_client
from sku import make_sku

SHEET_NAME = "Inventory"
HEADER_ROW = 1


# --------------------------------------------------------------------------- #
# Helpers (unchanged -- processor-agnostic)
# --------------------------------------------------------------------------- #
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
        lambda r: make_sku(r["Brand"], r["Product Name"], r.get("Concentration"), r["Size"]),
        axis=1,
    )
    return df.reset_index(drop=True)


def fetch_clover_ids(client) -> dict:
    """Return {sku: (item_group_id, item_id)} for everything in the Clover
    catalog. expand=itemGroup surfaces the parent group id alongside the
    item's own id."""
    mapping = {}
    for item in client.list_items(expand="itemGroup"):
        sku = item.get("sku")
        if not sku:
            continue
        item_group = item.get("itemGroup") or {}
        mapping[sku] = (item_group.get("id"), item["id"])
    return mapping


# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #
UPSERT = """
INSERT INTO dim_products (
    sku, clover_item_id, clover_variation_id,
    brand, product_name, concentration, size,
    price_cents, cost_cents,
    scent_family, top_notes, heart_notes, base_notes, gender, description,
    updated_at
) VALUES (
    %(sku)s, %(item_group_id)s, %(item_id)s,
    %(brand)s, %(product_name)s, %(concentration)s, %(size)s,
    %(price_cents)s, %(cost_cents)s,
    %(scent_family)s, %(top_notes)s, %(heart_notes)s, %(base_notes)s,
    %(gender)s, %(description)s,
    now()
)
ON CONFLICT (sku) DO UPDATE SET
    clover_item_id      = COALESCE(EXCLUDED.clover_item_id, dim_products.clover_item_id),
    clover_variation_id = COALESCE(EXCLUDED.clover_variation_id, dim_products.clover_variation_id),
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


def build_rows(df: pd.DataFrame, clover_ids: dict):
    rows, unmatched = [], []
    for _, r in df.iterrows():
        sku = r["SKU"]
        item_group_id, item_id = clover_ids.get(sku, (None, None))
        if item_id is None:
            unmatched.append(sku)
        rows.append({
            "sku": sku,
            "item_group_id": item_group_id,
            "item_id": item_id,
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

    print("Fetching Clover catalog ids...")
    client = get_client()
    clover_ids = fetch_clover_ids(client)
    print(f"Clover: {len(clover_ids)} items with SKUs.")

    rows, unmatched = build_rows(df, clover_ids)
    matched = len(rows) - len(unmatched)
    print(f"Matched {matched}/{len(rows)} products to Clover item ids.")
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
    # Supabase's transaction pooler doesn't support server-side prepared
    # statements -- executemany() over many rows re-uses the same statement
    # shape repeatedly, which auto-prepares after 5 uses by default and then
    # fails once the pooler routes a later call to a different backend
    # connection (confirmed live in sync_fraganty_images.py; see root
    # CLAUDE.md). prepare_threshold=None turns that auto-prepare off.
    with psycopg.connect(url, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT, rows)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COUNT(clover_variation_id) FROM dim_products")
            total, linked = cur.fetchone()
    print(f"\ndim_products: {total} rows, {linked} linked to Clover.")


if __name__ == "__main__":
    main()
