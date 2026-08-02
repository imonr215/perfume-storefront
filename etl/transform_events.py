"""
transform_events.py -- turn raw webhook events into the fact tables.

Reads unprocessed rows from raw_square_events, fetches the full order from
Square (the webhook itself carries only a stub: order_id, location_id, state,
version), and upserts fact_orders / fact_line_items / dim_customers.

Why fetch instead of parse: Square's order.created payload has no line items,
totals, or customer. The stub tells you *that* something happened and which
order; you have to ask Square for the details.

Failure handling: an event that can't be processed gets process_error set and
processed_at left NULL, so it stays in the backlog and is retried on the next
run. Nothing is ever lost -- that's the point of keeping the raw layer.

Usage:
    python transform_events.py                # process the backlog
    python transform_events.py --limit 50
    python transform_events.py --reprocess    # clear processed_at, redo everything
"""

import argparse
import os
import sys

import psycopg
from dotenv import load_dotenv

ORDER_EVENTS = {"order.created", "order.updated", "order.fulfillment.updated"}

# How to classify an order's channel from Square's source name.
# POS sales come from the Square Point of Sale app; anything created by our own
# application id is a storefront order.
POS_SOURCE_HINTS = ("point of sale", "square pos", "register")


# --------------------------------------------------------------------------- #
# Square
# --------------------------------------------------------------------------- #
def get_client():
    from square import Square
    from square.environment import SquareEnvironment

    token = os.environ.get("SQUARE_ACCESS_TOKEN")
    if not token:
        sys.exit("SQUARE_ACCESS_TOKEN is not set")
    env_name = os.environ.get("SQUARE_ENVIRONMENT", "sandbox").lower()
    env = SquareEnvironment.PRODUCTION if env_name == "production" else SquareEnvironment.SANDBOX
    return Square(environment=env, token=token)


def fetch_order(client, order_id):
    """Retrieve one full order. Returns the order object or raises."""
    resp = client.orders.get(order_id=order_id)
    order = getattr(resp, "order", None)
    if order is None:
        raise RuntimeError(f"no order in response for {order_id}")
    return order


# --------------------------------------------------------------------------- #
# Mapping
# --------------------------------------------------------------------------- #
def money(obj):
    """Square Money -> integer cents (or None)."""
    if obj is None:
        return None
    amount = getattr(obj, "amount", None)
    return int(amount) if amount is not None else None


def classify_channel(order) -> tuple[str, str | None]:
    source = getattr(order, "source", None)
    name = getattr(source, "name", None) if source else None
    if not name:
        return "unknown", None
    lowered = name.lower()
    if any(hint in lowered for hint in POS_SOURCE_HINTS):
        return "in_store", name
    return "online", name


def extract_order_id(payload: dict) -> str | None:
    obj = (payload.get("data") or {}).get("object") or {}
    for key in ("order_created", "order_updated", "order_fulfillment_updated", "order"):
        entity = obj.get(key)
        if isinstance(entity, dict):
            oid = entity.get("order_id") or entity.get("id")
            if oid:
                return oid
    return (payload.get("data") or {}).get("id")


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #
UPSERT_CUSTOMER = """
INSERT INTO dim_customers (square_customer_id, first_order_at, last_order_at,
                           order_count, lifetime_cents, first_channel)
VALUES (%(cid)s, %(at)s, %(at)s, 1, %(total)s, %(channel)s)
ON CONFLICT (square_customer_id) DO UPDATE SET
    last_order_at  = GREATEST(dim_customers.last_order_at, EXCLUDED.last_order_at),
    first_order_at = LEAST(dim_customers.first_order_at, EXCLUDED.first_order_at),
    updated_at     = now()
"""

UPSERT_ORDER = """
INSERT INTO fact_orders (
    square_order_id, square_customer_id, location_id, channel, source_name,
    state, total_cents, discount_cents, tax_cents, ordered_at, closed_at, updated_at
) VALUES (
    %(order_id)s, %(customer_id)s, %(location_id)s, %(channel)s, %(source_name)s,
    %(state)s, %(total)s, %(discount)s, %(tax)s, %(created_at)s, %(closed_at)s, now()
)
ON CONFLICT (square_order_id) DO UPDATE SET
    square_customer_id = EXCLUDED.square_customer_id,
    location_id        = EXCLUDED.location_id,
    channel            = EXCLUDED.channel,
    source_name        = EXCLUDED.source_name,
    state              = EXCLUDED.state,
    total_cents        = EXCLUDED.total_cents,
    discount_cents     = EXCLUDED.discount_cents,
    tax_cents          = EXCLUDED.tax_cents,
    ordered_at         = EXCLUDED.ordered_at,
    closed_at          = EXCLUDED.closed_at,
    updated_at         = now()
"""

UPSERT_LINE = """
INSERT INTO fact_line_items (
    square_order_id, square_line_uid, sku, square_variation_id,
    quantity, unit_price_cents, total_cents, ordered_at, channel
) VALUES (
    %(order_id)s, %(uid)s,
    (SELECT sku FROM dim_products WHERE square_variation_id = %(variation_id)s),
    %(variation_id)s, %(quantity)s, %(unit_price)s, %(total)s, %(ordered_at)s, %(channel)s
)
ON CONFLICT (square_order_id, square_line_uid) DO UPDATE SET
    sku                 = EXCLUDED.sku,
    square_variation_id = EXCLUDED.square_variation_id,
    quantity            = EXCLUDED.quantity,
    unit_price_cents    = EXCLUDED.unit_price_cents,
    total_cents         = EXCLUDED.total_cents,
    ordered_at          = EXCLUDED.ordered_at,
    channel             = EXCLUDED.channel
"""


def write_order(cur, order):
    channel, source_name = classify_channel(order)
    customer_id = getattr(order, "customer_id", None)
    created_at = getattr(order, "created_at", None)
    total = money(getattr(order, "total_money", None))

    if customer_id:
        cur.execute(UPSERT_CUSTOMER, {
            "cid": customer_id, "at": created_at,
            "total": total or 0, "channel": channel,
        })

    cur.execute(UPSERT_ORDER, {
        "order_id": order.id,
        "customer_id": customer_id,
        "location_id": getattr(order, "location_id", None),
        "channel": channel,
        "source_name": source_name,
        "state": getattr(order, "state", None),
        "total": total,
        "discount": money(getattr(order, "total_discount_money", None)) or 0,
        "tax": money(getattr(order, "total_tax_money", None)) or 0,
        "created_at": created_at,
        "closed_at": getattr(order, "closed_at", None),
    })

    lines = getattr(order, "line_items", None) or []
    for li in lines:
        cur.execute(UPSERT_LINE, {
            "order_id": order.id,
            "uid": getattr(li, "uid", None),
            "variation_id": getattr(li, "catalog_object_id", None),
            "quantity": getattr(li, "quantity", "1"),
            "unit_price": money(getattr(li, "base_price_money", None)),
            "total": money(getattr(li, "total_money", None)),
            "ordered_at": created_at,
            "channel": channel,
        })
    return len(lines)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--reprocess", action="store_true",
                    help="clear processed_at on all rows and redo them")
    args = ap.parse_args()

    load_dotenv("../.env")
    load_dotenv()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set")

    client = get_client()

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            if args.reprocess:
                cur.execute("UPDATE raw_square_events SET processed_at = NULL, process_error = NULL")
                conn.commit()
                print("Cleared processed_at on all events.")

            cur.execute("""
                SELECT id, event_id, event_type, payload
                FROM raw_square_events
                WHERE processed_at IS NULL
                ORDER BY received_at
                LIMIT %s
            """, (args.limit,))
            rows = cur.fetchall()

        print(f"{len(rows)} unprocessed event(s).")
        ok = skipped = failed = 0

        for row_id, event_id, event_type, payload in rows:
            if isinstance(payload, str):
                import json
                payload = json.loads(payload)

            if event_type not in ORDER_EVENTS:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE raw_square_events SET processed_at = now() WHERE id = %s",
                        (row_id,))
                conn.commit()
                skipped += 1
                continue

            order_id = extract_order_id(payload)
            try:
                if not order_id:
                    raise ValueError("no order id in payload")
                order = fetch_order(client, order_id)
                with conn.cursor() as cur:
                    n_lines = write_order(cur, order)
                    cur.execute(
                        "UPDATE raw_square_events SET processed_at = now(), process_error = NULL WHERE id = %s",
                        (row_id,))
                conn.commit()
                ok += 1
                print(f"  {order_id}: {n_lines} line item(s)")
            except Exception as err:
                conn.rollback()
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE raw_square_events SET process_error = %s WHERE id = %s",
                        (str(err)[:500], row_id))
                conn.commit()
                failed += 1
                print(f"  {order_id or event_id}: FAILED -- {str(err)[:120]}")

        print(f"\nprocessed {ok} | skipped {skipped} | failed {failed}")

        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM fact_orders")
            orders = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM fact_line_items")
            lines = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM fact_line_items WHERE sku IS NULL")
            unmatched = cur.fetchone()[0]
        print(f"fact_orders: {orders} | fact_line_items: {lines} "
              f"({unmatched} without a matched SKU)")


if __name__ == "__main__":
    main()
