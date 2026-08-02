"""
reset_catalog.py -- delete every catalog object in the target Square environment.

Needed when SKUs change: Square's BatchUpsertCatalogObjects treats a
'#'-prefixed id as a NEW object, so re-importing with different SKUs would
create a second copy of the catalog rather than updating it. Wiping first
guarantees one clean set.

SAFETY: refuses to run against production unless --i-know-this-is-production
is passed. This deletes the entire catalog; there is no undo.

Usage:
    python reset_catalog.py            # list what would be deleted
    python reset_catalog.py --confirm  # actually delete
"""

import argparse
import os
import sys

from dotenv import load_dotenv


def get_client():
    from square import Square
    from square.environment import SquareEnvironment

    token = os.environ.get("SQUARE_ACCESS_TOKEN")
    if not token:
        sys.exit("SQUARE_ACCESS_TOKEN is not set in .env")
    env_name = os.environ.get("SQUARE_ENVIRONMENT", "sandbox").lower()
    env = SquareEnvironment.PRODUCTION if env_name == "production" else SquareEnvironment.SANDBOX
    return Square(environment=env, token=token), env_name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirm", action="store_true", help="perform the deletion")
    ap.add_argument("--i-know-this-is-production", action="store_true")
    args = ap.parse_args()

    load_dotenv()
    client, env_name = get_client()

    if env_name == "production" and not args.i_know_this_is_production:
        sys.exit("Refusing to wipe a PRODUCTION catalog. "
                 "Pass --i-know-this-is-production if you really mean it.")

    item_ids = []
    names = []
    for obj in client.catalog.list(types="ITEM"):
        item_ids.append(obj.id)
        item_data = getattr(obj, "item_data", None)
        names.append(getattr(item_data, "name", "?") if item_data else "?")

    print(f"Environment: {env_name}")
    print(f"Found {len(item_ids)} catalog items.")
    if not item_ids:
        return
    print("  e.g. " + ", ".join(names[:3]) + (" ..." if len(names) > 3 else ""))

    if not args.confirm:
        print("\nDry run. Re-run with --confirm to delete these.")
        return

    # Deleting an ITEM cascades to its variations.
    deleted = 0
    for i in range(0, len(item_ids), 200):
        chunk = item_ids[i:i + 200]
        client.catalog.batch_delete(object_ids=chunk)
        deleted += len(chunk)
        print(f"  deleted {deleted}/{len(item_ids)}")
    print("Catalog cleared.")


if __name__ == "__main__":
    main()
