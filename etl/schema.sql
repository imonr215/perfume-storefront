-- ============================================================================
-- Perfume storefront warehouse schema
--
-- Design: raw-first. Every Square webhook lands in raw_square_events verbatim
-- and is never mutated. The analytics tables below are derived from it, so
-- they can always be rebuilt -- if we later need a field we didn't parse
-- today, the original payload is still there.
--
-- Square is the system of record for catalog/inventory/orders. This warehouse
-- exists for the things Square won't do: recommendations, cohort analysis,
-- and demand forecasting across both online and in-store channels.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RAW LAYER (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_square_events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    merchant_id     TEXT,
    location_id     TEXT,
    payload         JSONB       NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    process_error   TEXT
);

-- Square retries a webhook up to 11 times over 24h. The same event_id arriving
-- twice must not create two rows -- this constraint is what makes the handler
-- idempotent (INSERT ... ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS ux_raw_events_event_id
    ON raw_square_events (event_id);

CREATE INDEX IF NOT EXISTS ix_raw_events_type_received
    ON raw_square_events (event_type, received_at DESC);

-- Partial index: the ETL only ever scans the unprocessed backlog.
CREATE INDEX IF NOT EXISTS ix_raw_events_unprocessed
    ON raw_square_events (received_at)
    WHERE processed_at IS NULL;


-- ---------------------------------------------------------------------------
-- 2. DIMENSIONS
-- ---------------------------------------------------------------------------

-- One row per sellable unit (a 50ml and 100ml of the same scent are 2 rows).
-- Scent attributes live here, NOT in Square -- they're what the recommender
-- runs on.
CREATE TABLE IF NOT EXISTS dim_products (
    sku                 TEXT PRIMARY KEY,
    square_item_id      TEXT,
    square_variation_id TEXT,

    brand               TEXT NOT NULL,
    product_name        TEXT NOT NULL,
    concentration       TEXT,
    size                TEXT,

    price_cents         INTEGER,
    cost_cents          INTEGER,

    -- recommendation features
    scent_family        TEXT,
    top_notes           TEXT[],
    heart_notes         TEXT[],
    base_notes          TEXT[],
    gender              TEXT,
    description         TEXT,

    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Real product photography, matched from the fraganty.ai paid API (see
    -- etl/sync_fraganty_images.py and root CLAUDE.md's "Product images"
    -- section for the licensing basis). NULL on either/both means no
    -- confident match was found -- the storefront falls back to
    -- BottleGlyph's generated artwork in that case, never a broken image.
    image_url             TEXT,
    image_transparent_url TEXT
);

-- image_url predates this file -- it was added directly against the live DB
-- rather than through schema.sql, so these ADD COLUMN IF NOT EXISTS lines
-- are what actually matter for that (and any other) already-existing
-- database; the columns above only take effect on a genuinely fresh install
-- (CREATE TABLE IF NOT EXISTS is a no-op once the table exists).
ALTER TABLE dim_products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE dim_products ADD COLUMN IF NOT EXISTS image_transparent_url TEXT;

CREATE INDEX IF NOT EXISTS ix_products_variation ON dim_products (square_variation_id);
CREATE INDEX IF NOT EXISTS ix_products_family    ON dim_products (scent_family);
CREATE INDEX IF NOT EXISTS ix_products_brand     ON dim_products (brand);


-- Customers appear only when Square attaches one to an order. Deliberately
-- minimal: we store the Square id and derived behaviour, not a copy of their
-- personal details. Square remains the record for contact info.
CREATE TABLE IF NOT EXISTS dim_customers (
    square_customer_id  TEXT PRIMARY KEY,
    first_order_at      TIMESTAMPTZ,
    last_order_at       TIMESTAMPTZ,
    order_count         INTEGER     NOT NULL DEFAULT 0,
    lifetime_cents      BIGINT      NOT NULL DEFAULT 0,
    first_channel       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- 3. FACTS
-- ---------------------------------------------------------------------------

-- channel is the backbone of the whole project: it's what lets us compare and
-- combine kiosk sales with QR/online sales in one model.
CREATE TABLE IF NOT EXISTS fact_orders (
    square_order_id     TEXT PRIMARY KEY,
    square_customer_id  TEXT REFERENCES dim_customers (square_customer_id),
    location_id         TEXT,

    channel             TEXT NOT NULL DEFAULT 'unknown'
        CHECK (channel IN ('online', 'in_store', 'unknown')),
    source_name         TEXT,           -- raw Square source, kept for auditing
    state               TEXT,           -- OPEN / COMPLETED / CANCELED

    total_cents         BIGINT,
    discount_cents      BIGINT DEFAULT 0,
    tax_cents           BIGINT DEFAULT 0,

    ordered_at          TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,

    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_orders_ordered_at ON fact_orders (ordered_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_channel    ON fact_orders (channel, ordered_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_customer   ON fact_orders (square_customer_id);


-- Line items drive both "frequently bought together" and per-SKU forecasting.
--
-- Every FK below that references dim_products (sku) is DEFERRABLE INITIALLY
-- DEFERRED, not the Postgres default (NOT DEFERRABLE / checked per-statement).
-- Confirmed needed live: renaming a SKU in dim_products (e.g. the 2026-08-16
-- migration adding Concentration to make_sku()) has to update dim_products
-- and every table that references it by value in the same transaction: with
-- the default NOT DEFERRABLE, the very first UPDATE fails immediately
-- because the referencing rows still point at the old (about-to-not-exist)
-- SKU -- there's no correct order of separate statements that satisfies a
-- non-deferred constraint here. Deferred-to-COMMIT checking is what makes a
-- coordinated multi-table rename possible at all; day-to-day single-row
-- inserts/updates behave identically either way.
CREATE TABLE IF NOT EXISTS fact_line_items (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    square_order_id     TEXT NOT NULL REFERENCES fact_orders (square_order_id) ON DELETE CASCADE,
    square_line_uid     TEXT NOT NULL,
    sku                 TEXT REFERENCES dim_products (sku) DEFERRABLE INITIALLY DEFERRED,
    square_variation_id TEXT,

    quantity            NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price_cents    BIGINT,
    total_cents         BIGINT,

    ordered_at          TIMESTAMPTZ,   -- denormalized from the order for fast time series
    channel             TEXT
);

-- One row per line per order, so a webhook replay updates instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS ux_line_items_order_uid
    ON fact_line_items (square_order_id, square_line_uid);

CREATE INDEX IF NOT EXISTS ix_line_items_sku_time ON fact_line_items (sku, ordered_at DESC);
CREATE INDEX IF NOT EXISTS ix_line_items_order    ON fact_line_items (square_order_id);


-- ---------------------------------------------------------------------------
-- 4. INVENTORY SNAPSHOTS (for forecasting + stockout detection)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fact_inventory_snapshots (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku             TEXT REFERENCES dim_products (sku) DEFERRABLE INITIALLY DEFERRED,
    location_id     TEXT,
    quantity        NUMERIC(10,2),
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_inventory_sku_time
    ON fact_inventory_snapshots (sku, captured_at DESC);


-- ---------------------------------------------------------------------------
-- 5. CONVENIENCE VIEWS
-- ---------------------------------------------------------------------------

-- Daily sales split by channel: the core dashboard chart.
CREATE OR REPLACE VIEW vw_daily_sales AS
SELECT
    date_trunc('day', ordered_at)::date AS sale_date,
    channel,
    COUNT(*)                            AS order_count,
    SUM(total_cents) / 100.0            AS revenue
FROM fact_orders
WHERE ordered_at IS NOT NULL
  AND state <> 'CANCELED'
GROUP BY 1, 2;

-- Per-SKU performance, joined to the scent attributes the recommender uses.
CREATE OR REPLACE VIEW vw_product_performance AS
SELECT
    p.sku,
    p.brand,
    p.product_name,
    p.scent_family,
    p.gender,
    COALESCE(SUM(li.quantity), 0)                AS units_sold,
    COALESCE(SUM(li.total_cents), 0) / 100.0     AS revenue,
    COUNT(DISTINCT li.square_order_id)           AS order_count
FROM dim_products p
LEFT JOIN fact_line_items li ON li.sku = p.sku
GROUP BY p.sku, p.brand, p.product_name, p.scent_family, p.gender;


-- ---------------------------------------------------------------------------
-- 6. STOREFRONT APPLICATION TABLES (accounts, cart, checkout)
--
-- Deliberately prefixed store_* and kept separate from the dim_/fact_
-- warehouse above. Those tables are analytics data, rebuilt asynchronously
-- from webhooks by transform_events.py -- fine for reporting, unusable for
-- "show the order the customer just paid for" or "log this customer in".
-- store_orders is the synchronous, transactional record the site itself
-- reads and writes at checkout time. It will legitimately disagree with
-- fact_orders for a few minutes after every purchase, until the webhook
-- backlog is processed; that's expected, not a bug to reconcile.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS store_customers (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT        NOT NULL UNIQUE,
    password_hash           TEXT        NOT NULL,
    name                    TEXT,
    phone                   TEXT,
    default_shipping_address JSONB,     -- prefill only, not a full address book
    square_customer_id      TEXT,       -- set lazily on first order (see lib/square.ts)

    failed_login_attempts  INTEGER     NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session tokens are never stored raw -- only their sha256 hash, so a DB
-- leak alone isn't enough to hijack a session (same asymmetry as the
-- webhook's HMAC signature check in api/webhooks/square/route.ts).
CREATE TABLE IF NOT EXISTS store_customer_sessions (
    token_hash  TEXT        PRIMARY KEY,
    customer_id UUID        NOT NULL REFERENCES store_customers (id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_sessions_customer
    ON store_customer_sessions (customer_id);

-- One persistent cart per account (customer_id UNIQUE); guest carts have
-- customer_id NULL and are found only via the cart_id cookie -- Postgres
-- doesn't enforce uniqueness across NULLs, so many guest carts can coexist.
CREATE TABLE IF NOT EXISTS store_carts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID        UNIQUE REFERENCES store_customers (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_cart_items (
    cart_id   UUID        NOT NULL REFERENCES store_carts (id) ON DELETE CASCADE,
    sku       TEXT        NOT NULL REFERENCES dim_products (sku) DEFERRABLE INITIALLY DEFERRED,
    quantity  INTEGER     NOT NULL CHECK (quantity > 0),
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cart_id, sku)
);

-- id doubles as the confirmation-page URL token, so it must be unguessable --
-- a guest with no account still needs to be able to open their receipt.
CREATE TABLE IF NOT EXISTS store_orders (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID        REFERENCES store_customers (id),
    guest_email         TEXT,

    square_order_id     TEXT,
    square_payment_id   TEXT,
    status              TEXT        NOT NULL DEFAULT 'paid'
        CHECK (status IN ('paid', 'failed', 'refunded')),

    subtotal_cents      BIGINT      NOT NULL,
    total_cents         BIGINT      NOT NULL,

    contact_name        TEXT,
    contact_email       TEXT        NOT NULL,
    contact_phone       TEXT,
    shipping_address    JSONB,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (customer_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_store_orders_customer ON store_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_store_orders_square    ON store_orders (square_order_id);

-- Snapshots product_name/brand/unit_price at purchase time -- a later catalog
-- price change must not rewrite what someone already paid.
CREATE TABLE IF NOT EXISTS store_order_items (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id          UUID    NOT NULL REFERENCES store_orders (id) ON DELETE CASCADE,
    sku               TEXT    NOT NULL,
    product_name      TEXT    NOT NULL,
    brand             TEXT,
    unit_price_cents  BIGINT  NOT NULL,
    quantity          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_store_order_items_order ON store_order_items (order_id);

-- A proper address book (multiple saved addresses, one marked default),
-- superseding store_customers.default_shipping_address -- that column is
-- left in place rather than dropped (it may already hold data from before
-- this table existed), but new code reads/writes addresses here instead.
CREATE TABLE IF NOT EXISTS store_customer_addresses (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID        NOT NULL REFERENCES store_customers (id) ON DELETE CASCADE,
    label           TEXT,
    recipient_name  TEXT        NOT NULL,
    phone           TEXT,
    address_line1   TEXT        NOT NULL,
    address_line2   TEXT,
    city            TEXT        NOT NULL,
    state           TEXT        NOT NULL,
    postal_code     TEXT        NOT NULL,
    country         TEXT        NOT NULL DEFAULT 'US',
    is_default      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_addresses_customer
    ON store_customer_addresses (customer_id);

-- Enforced at the DB level, not just in application code: at most one
-- default address per customer.
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_addresses_default
    ON store_customer_addresses (customer_id) WHERE is_default;

-- Wishlist: logged-in only (unlike the cart, no guest/cookie version --
-- saving things for later only really makes sense once it follows you
-- across devices, which requires an account).
CREATE TABLE IF NOT EXISTS store_wishlist_items (
    customer_id UUID        NOT NULL REFERENCES store_customers (id) ON DELETE CASCADE,
    sku         TEXT        NOT NULL REFERENCES dim_products (sku) DEFERRABLE INITIALLY DEFERRED,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (customer_id, sku)
);

CREATE INDEX IF NOT EXISTS ix_wishlist_items_customer
    ON store_wishlist_items (customer_id, added_at DESC);
