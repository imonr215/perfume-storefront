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
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
CREATE TABLE IF NOT EXISTS fact_line_items (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    square_order_id     TEXT NOT NULL REFERENCES fact_orders (square_order_id) ON DELETE CASCADE,
    square_line_uid     TEXT NOT NULL,
    sku                 TEXT REFERENCES dim_products (sku),
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
    sku             TEXT REFERENCES dim_products (sku),
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
