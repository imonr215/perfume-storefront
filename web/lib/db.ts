import postgres from "postgres";

/**
 * Single shared Postgres client.
 *
 * In dev, Next.js hot-reloads modules on every edit, which would otherwise
 * open a new pool each time and exhaust Postgres connections within minutes.
 * Stashing the client on globalThis keeps one instance across reloads.
 *
 * DATABASE_URL should be Supabase's *transaction pooler* string (port 6543):
 * serverless functions open and drop connections constantly, which is exactly
 * what that pooler is built for.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Cast rather than `declare global`: module augmentation of `var` trips
// ESLint's no-var rule and behaves inconsistently across TS configs.
const globalForSql = globalThis as unknown as {
  _sql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForSql._sql ??
  postgres(connectionString, {
    // A single page render can need more than a handful of connections at
    // once -- app/layout.tsx alone fires 2 (getSession + getCart) on every
    // page, and app/page.tsx fires 6 more of its own in one Promise.all
    // (products, count, families, genders, concentrations, recently-viewed).
    // That's 8 concurrent queries for one home-page load; max previously
    // capped this pool at 5, so every load queued on itself before any
    // second tab or double-click even entered the picture.
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase's pooler doesn't support prepared statements in transaction mode.
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForSql._sql = sql;
}
