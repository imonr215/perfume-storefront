"""
reset_catalog.py -- delete every item (and item group) in the target Clover
merchant's catalog.

Needed when SKUs change: re-running clover_import.py against a catalog with
stale item groups/attributes from a previous SKU scheme would create a
second, parallel set rather than cleanly replacing it (Clover's item-group
model has no batch-upsert/idempotency-key concept to lean on the way
Square's catalog API does -- see clover_client.py). Wiping first guarantees
one clean set.

SAFETY: refuses to run against a merchant id that looks like production
unless --i-know-this-is-production is passed. This deletes the entire
catalog; there is no undo.

Usage:
    python reset_catalog.py            # list what would be deleted
    python reset_catalog.py --confirm  # actually delete
"""

import argparse
import os
import sys

from dotenv import load_dotenv

from clover_client import get_client


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirm", action="store_true", help="perform the deletion")
    ap.add_argument("--i-know-this-is-production", action="store_true")
    args = ap.parse_args()

    load_dotenv()

    env_name = os.environ.get("CLOVER_ENVIRONMENT", "sandbox").lower()
    if env_name == "production" and not args.i_know_this_is_production:
        sys.exit("Refusing to wipe a PRODUCTION catalog. "
                 "Pass --i-know-this-is-production if you really mean it.")

    client = get_client()

    items = list(client.list_items())
    item_groups = client.get("/item_groups").get("elements") or []

    print(f"Environment: {env_name}")
    print(f"Found {len(items)} item(s), {len(item_groups)} item group(s).")
    if items:
        sample_names = [i.get("name", "?") for i in items[:3]]
        print("  e.g. " + ", ".join(sample_names) + (" ..." if len(items) > 3 else ""))
    if not items and not item_groups:
        return

    if not args.confirm:
        print("\nDry run. Re-run with --confirm to delete these.")
        return

    deleted = 0
    for item in items:
        client.delete_item(item["id"])
        deleted += 1
        if deleted % 50 == 0:
            print(f"  deleted {deleted}/{len(items)} items")
    print(f"  deleted {deleted}/{len(items)} items")

    for group in item_groups:
        client.delete_item_group(group["id"])
    print(f"  deleted {len(item_groups)} item group(s)")
    print("Catalog cleared.")


if __name__ == "__main__":
    main()
