"""
reconcile_skus.py -- after renaming dim_products.product_name to match
fraganty.ai's actual title (see simplify_descriptions.py and this
session's manual photo-matching pass), the SKU itself (derived from the
OLD name via make_sku()) is now stale. This recomputes the correct SKU
from each active product's current brand/product_name/concentration/size
and, wherever that differs from what's on record, renames it everywhere
it's used: dim_products (the primary key), every table with a live FK to
it (store_cart_items, store_wishlist_items, fact_line_items,
fact_inventory_snapshots -- confirmed via schema.sql, all DEFERRABLE
INITIALLY DEFERRED so a single transaction can update parent + children
together without hitting the FK check until commit), and the
corresponding Clover item's own sku field (confirmed live: POST
/items/{itemId} with {"sku": ...}, same pattern as set_item_stock).

Deliberately does NOT touch store_order_items.sku -- that table has no FK
to dim_products at all (by design, per schema.sql: it's a denormalized
receipt snapshot of what was actually ordered under its original label,
not meant to track the live catalog).

Usage:
    python reconcile_skus.py --dry-run
    python reconcile_skus.py
"""

import argparse

from dotenv import load_dotenv

from clover_client import get_client
from sku import make_sku
from sync_fraganty_images import get_conn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="preview only, no writes")
    args = ap.parse_args()

    load_dotenv("../.env")
    clover = get_client()
    conn = get_conn()
    conn.autocommit = False  # explicit per-SKU transactions, see below

    with conn.cursor() as cur:
        cur.execute(
            "SELECT sku, brand, product_name, concentration, size, clover_variation_id "
            "FROM dim_products WHERE is_active ORDER BY brand, product_name"
        )
        rows = cur.fetchall()

    mismatches = []
    for sku, brand, product_name, concentration, size, clover_variation_id in rows:
        expected = make_sku(brand, product_name, concentration, size)
        if expected != sku:
            mismatches.append((sku, expected, brand, product_name, clover_variation_id))

    print(f"{len(rows)} active products, {len(mismatches)} SKU(s) need renaming.\n")
    for old_sku, new_sku, brand, product_name, _ in mismatches:
        print(f"  {old_sku}")
        print(f"    -> {new_sku}  ({brand} {product_name!r})")

    if args.dry_run:
        print("\n(dry run -- nothing written)")
        return

    renamed = 0
    for old_sku, new_sku, brand, product_name, clover_variation_id in mismatches:
        with conn.cursor() as cur:
            cur.execute("UPDATE store_cart_items SET sku = %s WHERE sku = %s", (new_sku, old_sku))
            cur.execute(
                "UPDATE store_wishlist_items SET sku = %s WHERE sku = %s", (new_sku, old_sku)
            )
            cur.execute("UPDATE fact_line_items SET sku = %s WHERE sku = %s", (new_sku, old_sku))
            cur.execute(
                "UPDATE fact_inventory_snapshots SET sku = %s WHERE sku = %s", (new_sku, old_sku)
            )
            cur.execute("UPDATE dim_products SET sku = %s WHERE sku = %s", (new_sku, old_sku))
        conn.commit()

        if clover_variation_id:
            clover.post(f"/items/{clover_variation_id}", {"sku": new_sku})

        print(f"renamed: {old_sku} -> {new_sku}" + (" (+ Clover)" if clover_variation_id else ""))
        renamed += 1

    print(f"\nDone. {renamed} SKU(s) renamed locally and on Clover.")


if __name__ == "__main__":
    main()
