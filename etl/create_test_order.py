"""
create_test_order.py -- place a real order in the Clover sandbox.

Clover's own canned test-event payloads reference object ids that don't
exist in your sandbox, so any transform that tries to fetch the full order
would fail on them -- the same limitation the old Square version of this
script existed to work around. This creates a genuine order from real
catalog items, which fires a genuine webhook carrying an id you can
actually retrieve.

Usage:
    python create_test_order.py                # 2 random items
    python create_test_order.py --items 3      # 3 random items
"""

import argparse
import os
import random
import sys

from dotenv import load_dotenv

from clover_client import get_client


def pick_items(client, n):
    """Grab n random items with a SKU from the catalog."""
    items = [i for i in client.list_items() if i.get("sku")]
    if not items:
        sys.exit("No catalog items found. Run clover_import.py first.")
    return random.sample(items, min(n, len(items)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", type=int, default=2)
    args = ap.parse_args()

    load_dotenv("../.env")
    load_dotenv()

    env_name = os.environ.get("CLOVER_ENVIRONMENT", "sandbox").lower()
    if env_name == "production":
        sys.exit("Refusing to create test orders in PRODUCTION.")

    client = get_client()
    picks = pick_items(client, args.items)

    print("Creating order with:")
    for item in picks:
        print(f"  - {item['sku']}")

    order = client.post("/orders", {})
    for item in picks:
        client.post(f"/orders/{order['id']}/line_items", {"item": {"id": item["id"]}})

    full = client.get(f"/orders/{order['id']}")
    total = sum(item.get("price", 0) for item in picks)
    print(f"\nOrder created: {full['id']}")
    print(f"  state: {full.get('state') or full.get('paymentState')}   total: ${total / 100:.2f}")
    print("\nThis should fire an order-related webhook within a few seconds.")


if __name__ == "__main__":
    main()
