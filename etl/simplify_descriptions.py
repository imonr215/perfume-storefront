"""
simplify_descriptions.py -- rewrite dim_products.description with the short,
plain-language copy from generate_descriptions.py's build_description(),
sourced from the DATABASE's own scent_family/top_notes rather than the
inventory spreadsheet.

Why not just re-run generate_descriptions.py --sql-out against the
spreadsheet: its "Scent Family" column predates this catalog's family
work -- the real 334-product inventory landed with ~68% of rows missing
scent_family entirely (see sync_fraganty_images.py's docstring), and
that gap has since been filled in two ways that only ever touched the
database, never the sheet: the earlier family-simplification pass, and
fraganty.ai accord-based inference during the photo sync. Building
descriptions from the spreadsheet's family column right now would mean
almost every product falling through to DEFAULT_FAMILY_PHRASE (confirmed
live -- a --dry-run against the sheet produced that generic fallback for
every sampled row) instead of the real, current family. dim_products is
the source of truth for scent_family today; this reads from there instead.

Reuses generate_descriptions.py's phrase pool and build_description()
unchanged (same copy, same SKU-deterministic rotation) rather than a
second copy of that logic -- only the data source differs. top_notes
comes back from Postgres as a native array (schema.sql), so it's rejoined
into a comma string here just so build_description()'s existing
parse_notes() (written for a spreadsheet cell) can split it right back
apart; simpler than forking that function for a list input.

Usage:
    python simplify_descriptions.py --dry-run
    python simplify_descriptions.py
"""

import argparse
import os
import sys

import psycopg
from dotenv import load_dotenv

from generate_descriptions import build_description


def get_conn():
    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set in .env")
    # prepare_threshold=None: see sync_fraganty_images.py's get_conn() --
    # same transaction-mode pooler, same repeated-parameterized-query-in-a-
    # loop shape here.
    return psycopg.connect(url, prepare_threshold=None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="preview only, no writes")
    args = ap.parse_args()

    conn = get_conn()
    conn.autocommit = True

    with conn.cursor() as cur:
        cur.execute(
            "SELECT sku, brand, product_name, scent_family, top_notes "
            "FROM dim_products WHERE is_active ORDER BY brand, product_name"
        )
        rows = cur.fetchall()

        print(f"{len(rows)} active products.\n")
        updated = 0
        for i, (sku, brand, product_name, scent_family, top_notes) in enumerate(rows):
            row = {
                "Scent Family": scent_family or "",
                "Top Notes": ", ".join(top_notes) if top_notes else None,
            }
            new_description = build_description(row, sku)

            if i < 6:
                print(f"{brand} {product_name} ({sku})")
                print(f"  family: {scent_family!r}")
                print(f"  new: {new_description}\n")

            if not args.dry_run:
                cur.execute(
                    "UPDATE dim_products SET description = %s, updated_at = now() WHERE sku = %s",
                    (new_description, sku),
                )
                updated += 1

    if args.dry_run:
        print("(dry run -- nothing written)")
    else:
        print(f"Updated {updated} descriptions.")


if __name__ == "__main__":
    main()
