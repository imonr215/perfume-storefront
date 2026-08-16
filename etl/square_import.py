"""
square_import.py — Load a perfume inventory spreadsheet into Square.

Reads the inventory workbook, maps each fragrance to Square's catalog model
(one ITEM per brand+name+concentration, one ITEM_VARIATION per size), upserts
the catalog, then sets opening stock levels.

Model
-----
  Item          = Brand + Product Name + Concentration   (e.g. "Dior Sauvage EDT")
  Variation     = Size                                    (e.g. "100ml") -> holds SKU, price, UPC
  Inventory     = Qty on Hand, set per variation at one location

Scent metadata (family, notes, gender) is intentionally NOT pushed to Square here.
It lives in our own store to power the recommendation layer (next build step);
the shop-voice blurb is written to the Square item description.

Usage
-----
  pip install squareup pandas openpyxl python-dotenv

  # .env  (never commit this file)
  #   SQUARE_ACCESS_TOKEN=your_sandbox_token
  #   SQUARE_ENVIRONMENT=sandbox          # sandbox | production
  #   SQUARE_LOCATION_ID=                  # optional; first location used if blank

  python square_import.py --file Perfume_Inventory_100.xlsx --dry-run   # build + inspect, no API calls
  python square_import.py --file Perfume_Inventory_100.xlsx             # live: upsert catalog + set stock

Start in --dry-run against the SANDBOX. Only point at production once the
sandbox round-trips cleanly.
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone

import pandas as pd

from sku import make_sku, slug  # noqa: F401 -- slug re-exported for callers that still import it from here

SHEET_NAME = "Inventory"
HEADER_ROW = 1          # 0-based; row 2 in the file holds the column headers
CURRENCY = "USD"
BATCH_SIZE = 500        # Square allows up to ~1000 objects/batch; stay well under


# --------------------------------------------------------------------------- #
# Load + clean
# --------------------------------------------------------------------------- #
def load_inventory(path: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=SHEET_NAME, header=HEADER_ROW, dtype=str)
    df.columns = [c.strip() for c in df.columns]

    # Keep only rows with the essentials filled in.
    df = df[df["Brand"].notna() & df["Product Name"].notna() & df["Size"].notna()].copy()

    # SKU is ALWAYS derived here, never read from the sheet.
    #
    # The sheet's SKU formula only substitutes spaces, so it preserves "&",
    # apostrophes, periods and accents (e.g. DOLCE-&-GABBANA-..., TOM-FORD-OMBRE\u0301-...).
    # make_sku() strips every non-alphanumeric character. Trusting the sheet in
    # one script and regenerating in another is how the two drift apart, which
    # silently breaks the SKU join between Square and the warehouse.
    # One function (etl/sku.py), used everywhere, is the invariant that keeps
    # them aligned -- see that file for why Concentration is part of the key.
    df["SKU"] = df.apply(
        lambda r: make_sku(r["Brand"], r["Product Name"], r.get("Concentration"), r["Size"]),
        axis=1,
    )

    # Numeric coercions.
    df["Price ($)"] = pd.to_numeric(df["Price ($)"], errors="coerce")
    df["Qty on Hand"] = pd.to_numeric(df["Qty on Hand"], errors="coerce").fillna(0).astype(int)

    problems = []
    missing_price = int(df["Price ($)"].isna().sum())
    if missing_price:
        problems.append(f"{missing_price} row(s) missing a valid price")
    dupes = df["SKU"][df["SKU"].duplicated()].unique().tolist()
    if dupes:
        problems.append(f"duplicate SKU(s): {', '.join(dupes[:5])}"
                        + (" ..." if len(dupes) > 5 else ""))
    if problems:
        raise ValueError("Spreadsheet needs fixing before import:\n  - " + "\n  - ".join(problems))

    return df.reset_index(drop=True)


def dollars_to_money(amount: float) -> dict:
    return {"amount": int(round(float(amount) * 100)), "currency": CURRENCY}


# --------------------------------------------------------------------------- #
# Build Square catalog objects
# --------------------------------------------------------------------------- #
def build_catalog_objects(df: pd.DataFrame):
    """Group rows into items (brand+name+concentration) with one variation per size.

    Returns (objects, sku_to_tempid) where sku_to_tempid maps each SKU to the
    temporary client id ("#var_...") we assign, so inventory can be matched to
    the real ids Square returns after upsert.
    """
    items = {}          # group_key -> item object (dict)
    sku_to_tempid = {}

    for _, r in df.iterrows():
        brand = str(r["Brand"]).strip()
        name = str(r["Product Name"]).strip()
        conc = str(r["Concentration"]).strip() if pd.notna(r["Concentration"]) else ""
        size = str(r["Size"]).strip()
        sku = r["SKU"]

        group_key = slug(f"{brand}-{name}-{conc}")
        item_temp = f"#item_{group_key}"
        var_temp = f"#var_{slug(sku)}"
        sku_to_tempid[sku] = var_temp

        if group_key not in items:
            display = " ".join(p for p in [brand, name, conc] if p)
            desc = str(r["Description (optional)"]).strip() if pd.notna(r.get("Description (optional)")) else ""
            items[group_key] = {
                "type": "ITEM",
                "id": item_temp,
                "present_at_all_locations": True,
                "item_data": {
                    "name": display,
                    "description": desc,
                    "variations": [],
                },
            }

        variation = {
            "type": "ITEM_VARIATION",
            "id": var_temp,
            "present_at_all_locations": True,
            "item_variation_data": {
                "item_id": item_temp,
                "name": size,
                "sku": sku,
                "pricing_type": "FIXED_PRICING",
                "price_money": dollars_to_money(r["Price ($)"]),
                "track_inventory": True,
            },
        }
        upc = str(r["Barcode / UPC"]).strip() if pd.notna(r.get("Barcode / UPC")) else ""
        if upc:
            variation["item_variation_data"]["upc"] = upc

        items[group_key]["item_data"]["variations"].append(variation)

    return list(items.values()), sku_to_tempid


# --------------------------------------------------------------------------- #
# Square API calls
# --------------------------------------------------------------------------- #
def get_client():
    from square import Square
    from square.environment import SquareEnvironment

    token = os.environ.get("SQUARE_ACCESS_TOKEN")
    if not token:
        sys.exit("SQUARE_ACCESS_TOKEN is not set. Put it in your .env file.")
    env_name = os.environ.get("SQUARE_ENVIRONMENT", "sandbox").lower()
    env = SquareEnvironment.PRODUCTION if env_name == "production" else SquareEnvironment.SANDBOX
    if env_name == "production":
        print("!! Targeting PRODUCTION — this writes to the real store account.")
    return Square(environment=env, token=token)


def resolve_location_id(client) -> str:
    loc = os.environ.get("SQUARE_LOCATION_ID")
    if loc:
        return loc
    resp = client.locations.list()
    locations = getattr(resp, "locations", None) or []
    if not locations:
        sys.exit("No locations found on this Square account.")
    return locations[0].id


def upsert_catalog(client, objects) -> dict:
    """Upsert items in batches. Returns {temp_id: real_id} from Square's id_mappings."""
    id_map = {}
    for i in range(0, len(objects), BATCH_SIZE):
        chunk = objects[i:i + BATCH_SIZE]
        resp = client.catalog.batch_upsert(
            idempotency_key=str(uuid.uuid4()),
            batches=[{"objects": chunk}],
        )
        for m in getattr(resp, "id_mappings", None) or []:
            client_id = getattr(m, "client_object_id", None) or m.get("client_object_id")
            object_id = getattr(m, "object_id", None) or m.get("object_id")
            id_map[client_id] = object_id
        print(f"  upserted objects {i + 1}-{i + len(chunk)} of {len(objects)}")
    return id_map


def set_inventory(client, df, sku_to_tempid, id_map, location_id):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    changes = []
    for _, r in df.iterrows():
        temp = sku_to_tempid[r["SKU"]]
        real_id = id_map.get(temp)
        if not real_id:
            print(f"  ! no Square id for {r['SKU']}, skipping stock")
            continue
        changes.append({
            "type": "PHYSICAL_COUNT",
            "physical_count": {
                "catalog_object_id": real_id,
                "location_id": location_id,
                "quantity": str(int(r["Qty on Hand"])),
                "state": "IN_STOCK",
                "occurred_at": now,
            },
        })
    for i in range(0, len(changes), BATCH_SIZE):
        chunk = changes[i:i + BATCH_SIZE]
        client.inventory.batch_create_changes(
            idempotency_key=str(uuid.uuid4()),
            changes=chunk,
            ignore_unchanged_counts=True,
        )
        print(f"  set stock for {i + 1}-{i + len(chunk)} of {len(changes)} variations")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Import a perfume inventory sheet into Square.")
    ap.add_argument("--file", required=True, help="Path to the inventory .xlsx")
    ap.add_argument("--dry-run", action="store_true",
                    help="Build and inspect payloads without calling Square")
    args = ap.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    df = load_inventory(args.file)
    objects, sku_to_tempid = build_catalog_objects(df)
    n_items = sum(1 for o in objects if o["type"] == "ITEM")
    n_vars = sum(len(o["item_data"]["variations"]) for o in objects)
    print(f"Parsed {len(df)} rows -> {n_items} items, {n_vars} variations.")

    if args.dry_run:
        out = "catalog_payload.json"
        with open(out, "w") as f:
            json.dump({"batches": [{"objects": objects}]}, f, indent=2)
        print(f"Dry run: wrote {out}. Sample item:")
        print(json.dumps(objects[0], indent=2)[:900])
        return

    client = get_client()
    location_id = resolve_location_id(client)
    print(f"Location: {location_id}")
    print("Upserting catalog...")
    id_map = upsert_catalog(client, objects)
    print("Setting opening stock...")
    set_inventory(client, df, sku_to_tempid, id_map, location_id)
    print("Done.")


if __name__ == "__main__":
    main()
