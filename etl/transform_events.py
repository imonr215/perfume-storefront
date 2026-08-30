"""
transform_events.py -- turn raw webhook events into the fact tables.

Reads unprocessed rows from raw_clover_events, fetches the full order from
Clover (the webhook itself carries only a stub -- an objectId like "O:xyz"
inside a merchants:{merchantId}:[...] array, no line items or totals), and
upserts fact_orders / fact_line_items / dim_customers.

Why fetch instead of parse: same reasoning as the old Square version -- the
webhook stub tells you *that* something happened and which object; you have
to ask Clover for the details.

Failure handling: an event that can't be processed gets process_error set
and processed_at left NULL, so it stays in the backlog and is retried on the
next run. Nothing is ever lost -- that's the point of keeping the raw layer.

Usage:
    python transform_events.py                # process the backlog
    python transform_events.py --limit 50
    python transform_events.py --reprocess    # clear processed_at, redo everything
"""

import argparse
import json
import os
import sys

import psycopg
from dotenv import load_dotenv

from clover_client import get_client

# Clover's webhook objectId prefixes -- confirmed live against this account's
# webhook deliveries (see the clover-spike webhook route this was diagnosed
# with). Only Orders and Payments carry anything we act on here; Inventory
# and Customers events are acknowledged (processed_at set) but not otherwise
# handled yet.
ORDER_PREFIXES = ("O:", "P:")


# --------------------------------------------------------------------------- #
# Clover
# --------------------------------------------------------------------------- #
def fetch_order(client, order_id):
    """Retrieve one full order, with its line items expanded."""
    return client.get_order(order_id, expand="lineItems")


# --------------------------------------------------------------------------- #
# Mapping
# --------------------------------------------------------------------------- #
def money(order: dict) -> int | None:
    """Clover's order/line-item amounts are already plain integer cents
    (confirmed live -- no nested {amount, currency} object the way Square's
    Money type has), so this is mostly a defensive None-check rather than a
    real unwrap."""
    return order if order is None else int(order)


def classify_channel(order: dict) -> tuple[str, str | None]:
    """Distinguish a remote-pay (web checkout) order from a walk-up in-store
    sale on the same physical Flex device.

    PROVISIONAL -- not yet verifiable without real hardware (see the
    migration plan's Phase 7). A live test order created directly via the
    Platform REST API (not through remote-pay) always carried an
    `employee: {id: ...}` matching the *account owner*, regardless of who
    actually initiated it -- so employee-presence is NOT a usable signal,
    contrary to an earlier assumption. No free-text note/title field was
    found on a plain order fetch either.

    Until a real remote-pay-created order can be inspected: try matching a
    `web-` prefix on the order's own id or on the SaleRequest's externalId
    if Clover surfaces one on a fetched order (unconfirmed field name);
    fall back to 'unknown' rather than guessing wrong in either direction.
    Revisit this the moment Phase 7 produces one real remote-pay order to
    look at.
    """
    external_id = order.get("externalPaymentId") or order.get("title") or ""
    if isinstance(external_id, str) and external_id.startswith("web-"):
        return "online", external_id
    return "unknown", None


def extract_object_ids(payload: dict) -> list[tuple[str, str]]:
    """Clover's webhook body is `{"merchants": {merchantId: [{"objectId":
    "O:xyz", "type": "CREATE", "ts": ...}, ...]}}` -- unlike Square's
    one-event-per-delivery body, a single POST can bundle several events, so
    this returns every (prefix, id) pair in the payload rather than one."""
    results = []
    merchants = (payload.get("merchants") or {})
    for events in merchants.values():
        for event in events or []:
            object_id = event.get("objectId") or ""
            if ":" in object_id:
                prefix, _, real_id = object_id.partition(":")
                results.append((prefix + ":", real_id))
    return results


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #
UPSERT_CUSTOMER = """
INSERT INTO dim_customers (clover_customer_id, first_order_at, last_order_at,
                           order_count, lifetime_cents, first_channel)
VALUES (%(cid)s, %(at)s, %(at)s, 1, %(total)s, %(channel)s)
ON CONFLICT (clover_customer_id) DO UPDATE SET
    last_order_at  = GREATEST(dim_customers.last_order_at, EXCLUDED.last_order_at),
    first_order_at = LEAST(dim_customers.first_order_at, EXCLUDED.first_order_at),
    updated_at     = now()
"""

UPSERT_ORDER = """
INSERT INTO fact_orders (
    clover_order_id, clover_customer_id, location_id, channel, source_name,
    state, total_cents, discount_cents, tax_cents, ordered_at, closed_at, updated_at
) VALUES (
    %(order_id)s, %(customer_id)s, %(location_id)s, %(channel)s, %(source_name)s,
    %(state)s, %(total)s, %(discount)s, %(tax)s, %(created_at)s, %(closed_at)s, now()
)
ON CONFLICT (clover_order_id) DO UPDATE SET
    clover_customer_id = EXCLUDED.clover_customer_id,
    location_id        = EXCLUDED.location_id,
    channel            = EXCLUDED.channel,
    source_name        = EXCLUDED.source_name,
    state               = EXCLUDED.state,
    total_cents        = EXCLUDED.total_cents,
    discount_cents     = EXCLUDED.discount_cents,
    tax_cents          = EXCLUDED.tax_cents,
    ordered_at         = EXCLUDED.ordered_at,
    closed_at          = EXCLUDED.closed_at,
    updated_at         = now()
"""

UPSERT_LINE = """
INSERT INTO fact_line_items (
    clover_order_id, clover_line_uid, sku, clover_variation_id,
    quantity, unit_price_cents, total_cents, ordered_at, channel
) VALUES (
    %(order_id)s, %(uid)s,
    (SELECT sku FROM dim_products WHERE clover_variation_id = %(item_id)s),
    %(item_id)s, %(quantity)s, %(unit_price)s, %(total)s, %(ordered_at)s, %(channel)s
)
ON CONFLICT (clover_order_id, clover_line_uid) DO UPDATE SET
    sku                 = EXCLUDED.sku,
    clover_variation_id = EXCLUDED.clover_variation_id,
    quantity            = EXCLUDED.quantity,
    unit_price_cents    = EXCLUDED.unit_price_cents,
    total_cents         = EXCLUDED.total_cents,
    ordered_at          = EXCLUDED.ordered_at,
    channel             = EXCLUDED.channel
"""


def write_order(cur, order: dict) -> int:
    channel, source_name = classify_channel(order)
    customer = order.get("customers") or {}
    customer_id = (customer.get("elements") or [{}])[0].get("id") if customer else None
    created_at_ms = order.get("createdTime")
    created_at = created_at_ms / 1000 if created_at_ms else None
    total = money(order.get("total"))

    if customer_id:
        cur.execute(UPSERT_CUSTOMER, {
            "cid": customer_id, "at": created_at,
            "total": total or 0, "channel": channel,
        })

    modified_at_ms = order.get("modifiedTime")
    cur.execute(UPSERT_ORDER, {
        "order_id": order["id"],
        "customer_id": customer_id,
        "location_id": None,  # single-location merchant; Clover's Order has no location_id field
        "channel": channel,
        "source_name": source_name,
        "state": order.get("state") or order.get("paymentState"),
        "total": total,
        "discount": 0,
        "tax": 0,
        "created_at": created_at,
        "closed_at": modified_at_ms / 1000 if modified_at_ms else None,
    })

    line_items = (order.get("lineItems") or {}).get("elements") or []
    for li in line_items:
        cur.execute(UPSERT_LINE, {
            "order_id": order["id"],
            "uid": li.get("id"),
            "item_id": (li.get("item") or {}).get("id"),
            "quantity": li.get("qty", 1) or 1,
            "unit_price": money(li.get("price")),
            "total": money(li.get("price")),
            "ordered_at": created_at,
            "channel": channel,
        })
    return len(line_items)


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

    # Supabase's transaction pooler doesn't support server-side prepared
    # statements -- this script runs the same parameterized queries in a
    # loop over many rows, which is exactly the pattern that auto-prepares
    # after 5 uses and then fails once the pooler routes a later call to a
    # different backend connection (confirmed live in sync_fraganty_images.py;
    # see root CLAUDE.md). prepare_threshold=None turns that off.
    with psycopg.connect(url, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            if args.reprocess:
                cur.execute("UPDATE raw_clover_events SET processed_at = NULL, process_error = NULL")
                conn.commit()
                print("Cleared processed_at on all events.")

            cur.execute("""
                SELECT id, event_id, event_type, payload
                FROM raw_clover_events
                WHERE processed_at IS NULL
                ORDER BY received_at
                LIMIT %s
            """, (args.limit,))
            rows = cur.fetchall()

        print(f"{len(rows)} unprocessed event(s).")
        ok = skipped = failed = 0

        for row_id, event_id, event_type, payload in rows:
            if isinstance(payload, str):
                payload = json.loads(payload)

            object_ids = extract_object_ids(payload)
            order_ids = [oid for prefix, oid in object_ids if prefix in ORDER_PREFIXES]

            if not order_ids:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE raw_clover_events SET processed_at = now() WHERE id = %s",
                        (row_id,))
                conn.commit()
                skipped += 1
                continue

            for order_id in order_ids:
                try:
                    order = fetch_order(client, order_id)
                    with conn.cursor() as cur:
                        n_lines = write_order(cur, order)
                        cur.execute(
                            "UPDATE raw_clover_events SET processed_at = now(), process_error = NULL WHERE id = %s",
                            (row_id,))
                    conn.commit()
                    ok += 1
                    print(f"  {order_id}: {n_lines} line item(s)")
                except Exception as err:
                    conn.rollback()
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE raw_clover_events SET process_error = %s WHERE id = %s",
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
