"""
create_test_order.py -- place a real order in the Square sandbox.

Square's "send test event" button posts a canned payload whose order_id
(eA3vssLHKJrv9H0IdJCM3gNqfdcZY) doesn't exist in your sandbox, so any
transform that tries to fetch the full order will 404 on it. This creates a
genuine order from real catalog variations, which fires a genuine
order.created webhook carrying an id you can actually retrieve.

Usage:
    python create_test_order.py                # 2 random items
    python create_test_order.py --items 3      # 3 random items
"""

import argparse
import os
import random
import sys
import uuid

from dotenv import load_dotenv


def get_client():
    from square import Square
    from square.environment import SquareEnvironment

    token = os.environ.get("SQUARE_ACCESS_TOKEN")
    if not token:
        sys.exit("SQUARE_ACCESS_TOKEN is not set")
    env_name = os.environ.get("SQUARE_ENVIRONMENT", "sandbox").lower()
    if env_name == "production":
        sys.exit("Refusing to create test orders in PRODUCTION.")
    return Square(environment=SquareEnvironment.SANDBOX, token=token)


def pick_variations(client, n):
    """Grab n random variation ids from the catalog."""
    variations = []
    for obj in client.catalog.list(types="ITEM"):
        item_data = getattr(obj, "item_data", None)
        if not item_data:
            continue
        for var in getattr(item_data, "variations", None) or []:
            vdata = getattr(var, "item_variation_data", None)
            if vdata and getattr(vdata, "sku", None):
                variations.append((var.id, vdata.sku))
    if not variations:
        sys.exit("No catalog variations found. Run square_import.py first.")
    return random.sample(variations, min(n, len(variations)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", type=int, default=2)
    args = ap.parse_args()

    load_dotenv("../.env")
    load_dotenv()

    client = get_client()
    location_id = os.environ.get("SQUARE_LOCATION_ID")
    if not location_id:
        location_id = next(iter(client.locations.list().locations)).id

    picks = pick_variations(client, args.items)
    line_items = [
        {"catalog_object_id": vid, "quantity": str(random.randint(1, 2))}
        for vid, _ in picks
    ]

    print(f"Creating order at {location_id} with:")
    for _, sku in picks:
        print(f"  - {sku}")

    resp = client.orders.create(
        idempotency_key=str(uuid.uuid4()),
        order={
            "location_id": location_id,
            "line_items": line_items,
            "state": "OPEN",
        },
    )

    order = getattr(resp, "order", None)
    if not order:
        sys.exit(f"Unexpected response: {resp}")

    total = getattr(getattr(order, "total_money", None), "amount", 0) or 0
    print(f"\nOrder created: {order.id}")
    print(f"  state: {order.state}   total: ${total / 100:.2f}")
    print("\nThis should fire an order.created webhook within a few seconds.")


if __name__ == "__main__":
    main()
