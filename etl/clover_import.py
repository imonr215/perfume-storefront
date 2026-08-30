"""
clover_import.py — Load a perfume inventory spreadsheet into Clover.

Replaces square_import.py. Reads the inventory workbook and maps each
fragrance to Clover's catalog model, which is structurally different from
Square's ITEM -> ITEM_VARIATION nesting (verified live against the sandbox,
not guessed from docs):

  Item group   = Brand + Product Name + Concentration  (e.g. "Dior Sauvage EDT")
  Attribute    = "Size", one per item group
  Attr option  = one per distinct size value within that group (e.g. "100ml")
  Item         = one per size, holds sku/price/upc, linked to the group via
                 itemGroup:{id} and to its size option via a separate
                 option_items link call
  Stock        = set per item via POST .../item_stocks/{itemId}

Clover auto-derives an item's *displayed* name from its group's name plus
its variant option once linked (confirmed live: an item created with an
explicit "name" ends up displayed as "{group name} {size}" regardless) --
so item_group.name is set to the human-readable "Brand Name Concentration"
string, and that alone is what actually shows up per-variant.

Scent metadata (family, notes, gender) is intentionally NOT pushed to
Clover here — see sync_products.py for where that lives.

Usage
-----
  # web/.env.local or root .env:
  #   CLOVER_API_TOKEN=<OAuth access_token -- NOT the merchant-dashboard
  #                      "Platform API" token, confirmed that one 401s>
  #   CLOVER_MERCHANT_ID=
  #   CLOVER_ENVIRONMENT=sandbox

  python clover_import.py --file Perfume_Inventory_Real.xlsx --dry-run
  python clover_import.py --file Perfume_Inventory_Real.xlsx

Start in --dry-run against the SANDBOX. Only point at production once the
sandbox round-trips cleanly, and never against the live kiosk merchant
without explicit owner sign-off (see the migration plan's Phase 7).
"""

import argparse
import json
import sys

import pandas as pd

from clover_client import get_client
from sku import make_sku, slug  # noqa: F401 -- slug re-exported for callers that still import it from here

SHEET_NAME = "Inventory"
HEADER_ROW = 1  # 0-based; row 2 in the file holds the column headers


# --------------------------------------------------------------------------- #
# Load + clean (unchanged from square_import.py -- processor-agnostic)
# --------------------------------------------------------------------------- #
def load_inventory(path: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=SHEET_NAME, header=HEADER_ROW, dtype=str)
    df.columns = [c.strip() for c in df.columns]

    df = df[df["Brand"].notna() & df["Product Name"].notna() & df["Size"].notna()].copy()

    # SKU is ALWAYS derived here, never read from the sheet -- see etl/sku.py.
    df["SKU"] = df.apply(
        lambda r: make_sku(r["Brand"], r["Product Name"], r.get("Concentration"), r["Size"]),
        axis=1,
    )

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


def to_cents(amount: float) -> int:
    return int(round(float(amount) * 100))


# --------------------------------------------------------------------------- #
# Build the group -> variant plan (no API calls -- this is what --dry-run
# inspects, and what the live path executes against)
# --------------------------------------------------------------------------- #
def build_catalog_plan(df: pd.DataFrame):
    """Group rows into item groups (brand+name+concentration) with one
    variant per size. Returns a list of group dicts:
        {group_key, display_name, variants: [{sku, size, price_cents, upc}]}
    """
    groups = {}
    for _, r in df.iterrows():
        brand = str(r["Brand"]).strip()
        name = str(r["Product Name"]).strip()
        conc = str(r["Concentration"]).strip() if pd.notna(r["Concentration"]) else ""
        size = str(r["Size"]).strip()
        sku = r["SKU"]

        group_key = slug(f"{brand}-{name}-{conc}")
        if group_key not in groups:
            display_name = " ".join(p for p in [brand, name, conc] if p)
            groups[group_key] = {
                "group_key": group_key,
                "display_name": display_name,
                "variants": [],
            }

        upc = str(r["Barcode / UPC"]).strip() if pd.notna(r.get("Barcode / UPC")) else ""
        groups[group_key]["variants"].append({
            "sku": sku,
            "size": size,
            "price_cents": to_cents(r["Price ($)"]),
            "qty": int(r["Qty on Hand"]),
            "upc": upc or None,
        })

    return list(groups.values())


# --------------------------------------------------------------------------- #
# Live upload (idempotent: skip anything that already exists by name/sku)
# --------------------------------------------------------------------------- #
def fetch_existing(client):
    """Existing item groups (name -> {id, size_attribute_id}) and items
    (sku -> id), so re-running this script doesn't create duplicates.
    Clover's Platform API has no batch-upsert/idempotency-key concept the
    way Square's catalog API does (confirmed -- no equivalent found), so
    this check-then-create approach is the idempotency mechanism here
    instead.

    `/item_groups/{id}/attributes` looks like it should list a group's
    attributes but is a genuine 405 (confirmed live) -- `expand=attributes`
    on the list endpoint is what actually works, and gets every group's
    attribute in the same one call rather than one extra round trip per
    group.
    """
    existing_groups = {}
    for g in client.get("/item_groups", params={"expand": "attributes"}).get("elements") or []:
        attrs = (g.get("attributes") or {}).get("elements") or []
        size_attr = next((a for a in attrs if a["name"] == "Size"), None)
        existing_groups[g["name"]] = {
            "id": g["id"],
            "size_attribute_id": size_attr["id"] if size_attr else None,
        }

    existing_items = {}
    for item in client.list_items():
        sku = item.get("sku")
        if sku:
            existing_items[sku] = item["id"]

    return existing_groups, existing_items


def upload_catalog(client, groups: list, dry_run_stock_only=False):
    existing_groups, existing_items = fetch_existing(client)
    print(f"  found {len(existing_groups)} existing item group(s), "
          f"{len(existing_items)} existing item(s) with a SKU")

    sku_to_item_id = dict(existing_items)
    n_groups_created = n_items_created = n_skipped = 0

    for group in groups:
        existing = existing_groups.get(group["display_name"])
        if existing is None:
            g = client.create_item_group(group["display_name"])
            group_id = g["id"]
            n_groups_created += 1

            size_attr_id = client.create_attribute(group_id, "Size")["id"]
            size_to_option = {}
        else:
            # Group already existed -- we still need its size->option map for
            # any brand-new variants (e.g. a new size added to an existing
            # fragrance since the last import).
            group_id = existing["id"]
            size_attr_id = existing["size_attribute_id"]
            if size_attr_id is None:
                size_attr_id = client.create_attribute(group_id, "Size")["id"]
                size_to_option = {}
            else:
                opts = client.get(f"/attributes/{size_attr_id}/options").get("elements") or []
                size_to_option = {o["name"]: o["id"] for o in opts}

        for variant in group["variants"]:
            if variant["sku"] in sku_to_item_id:
                n_skipped += 1
                continue

            if variant["size"] not in size_to_option:
                opt = client.create_attribute_option(size_attr_id, variant["size"])
                size_to_option[variant["size"]] = opt["id"]

            item = client.create_item(
                name=group["display_name"],  # Clover overrides the display with group+option anyway
                price_cents=variant["price_cents"],
                sku=variant["sku"],
                item_group_id=group_id,
                upc=variant["upc"],
            )
            client.link_option_item(size_to_option[variant["size"]], item["id"])
            sku_to_item_id[variant["sku"]] = item["id"]
            n_items_created += 1

    print(f"  created {n_groups_created} item group(s), {n_items_created} item(s) "
          f"({n_skipped} already existed, skipped)")
    return sku_to_item_id


def set_opening_stock(client, groups: list, sku_to_item_id: dict):
    n_set = n_skipped = 0
    for group in groups:
        for variant in group["variants"]:
            item_id = sku_to_item_id.get(variant["sku"])
            if not item_id:
                print(f"  ! no Clover item id for {variant['sku']}, skipping stock")
                n_skipped += 1
                continue
            client.set_item_stock(item_id, variant["qty"])
            n_set += 1
    print(f"  set stock for {n_set} item(s) ({n_skipped} skipped)")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Import a perfume inventory sheet into Clover.")
    ap.add_argument("--file", required=True, help="Path to the inventory .xlsx")
    ap.add_argument("--dry-run", action="store_true",
                    help="Build and inspect the plan without calling Clover")
    args = ap.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    df = load_inventory(args.file)
    groups = build_catalog_plan(df)
    n_variants = sum(len(g["variants"]) for g in groups)
    print(f"Parsed {len(df)} rows -> {len(groups)} item group(s), {n_variants} variant(s).")

    if args.dry_run:
        out = "clover_catalog_plan.json"
        with open(out, "w") as f:
            json.dump(groups, f, indent=2)
        print(f"Dry run: wrote {out}. Sample group:")
        print(json.dumps(groups[0], indent=2)[:900])
        return

    client = get_client()
    print("Uploading catalog...")
    sku_to_item_id = upload_catalog(client, groups)
    print("Setting opening stock...")
    set_opening_stock(client, groups, sku_to_item_id)
    print("Done.")


if __name__ == "__main__":
    main()
