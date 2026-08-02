"""
apply_schema.py -- create (or update) the warehouse schema in Postgres.

Every statement in schema.sql is written to be idempotent
(CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE VIEW), so this is safe to
re-run: it will not drop data or error on objects that already exist.

Usage:
    python apply_schema.py                 # apply schema.sql
    python apply_schema.py --verify        # just list what's there now
"""

import argparse
import os
import sys

import psycopg
from dotenv import load_dotenv

SCHEMA_FILE = "schema.sql"


def get_conn():
    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set in .env")
    return psycopg.connect(url)


def apply_schema(conn):
    with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print(f"Applied {SCHEMA_FILE}.")


def verify(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_type, table_name
        """)
        rows = cur.fetchall()
        print(f"\n{len(rows)} objects in public schema:")
        for name, kind in rows:
            label = "view " if kind == "VIEW" else "table"
            print(f"  {label}  {name}")

        cur.execute("""
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY indexname
        """)
        print(f"\n{len(cur.fetchall())} indexes.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true",
                    help="only list existing objects, don't apply")
    args = ap.parse_args()

    with get_conn() as conn:
        if not args.verify:
            apply_schema(conn)
        verify(conn)


if __name__ == "__main__":
    main()
