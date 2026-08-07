import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { compare, hash } from "bcryptjs";
import { sql } from "@/lib/db";

export type SessionCustomer = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  defaultShippingAddress: Record<string, unknown> | null;
};

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Never a real bcrypt hash of anything -- just gives an unknown-email login
// attempt the same rough cost as a real one, so response timing doesn't
// betray whether an account exists.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeOfMR1UlJZzM3jUV3v2jP7iu.4d0V0GgS";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function createSession(customerId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await sql`
    INSERT INTO store_customer_sessions (token_hash, customer_id, expires_at)
    VALUES (${hashToken(token)}, ${customerId}, ${expiresAt})
  `;

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession(): Promise<SessionCustomer | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await sql<
    {
      id: string;
      email: string;
      name: string | null;
      phone: string | null;
      default_shipping_address: Record<string, unknown> | null;
    }[]
  >`
    SELECT c.id, c.email, c.name, c.phone, c.default_shipping_address
    FROM store_customer_sessions s
    JOIN store_customers c ON c.id = s.customer_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    defaultShippingAddress: row.default_shipping_address,
  };
}

/** For pages that require a logged-in customer -- redirects, never throws. */
export async function requireSession(): Promise<SessionCustomer> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await sql`DELETE FROM store_customer_sessions WHERE token_hash = ${hashToken(token)}`;
  }
  store.delete(SESSION_COOKIE);
}

export type LoginResult =
  | { ok: true; customerId: string }
  | { ok: false; error: "invalid" | "locked" };

/**
 * Verifies email/password and applies a simple per-account lockout after
 * repeated failures -- there's no shared rate limiter (e.g. Redis) in this
 * project, so this is the affordable version: a counter on the row itself.
 */
export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();

  const rows = await sql<
    {
      id: string;
      password_hash: string;
      failed_login_attempts: number;
      locked_until: Date | null;
    }[]
  >`
    SELECT id, password_hash, failed_login_attempts, locked_until
    FROM store_customers
    WHERE email = ${normalizedEmail}
    LIMIT 1
  `;
  const account = rows[0];

  if (!account) {
    await compare(password, DUMMY_HASH); // constant-ish time, see DUMMY_HASH
    return { ok: false, error: "invalid" };
  }

  if (account.locked_until && account.locked_until > new Date()) {
    return { ok: false, error: "locked" };
  }

  const valid = await compare(password, account.password_hash);
  if (!valid) {
    const attempts = account.failed_login_attempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
    await sql`
      UPDATE store_customers
      SET failed_login_attempts = ${attempts}, locked_until = ${lockedUntil}, updated_at = now()
      WHERE id = ${account.id}
    `;
    return { ok: false, error: lockedUntil ? "locked" : "invalid" };
  }

  await sql`
    UPDATE store_customers
    SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE id = ${account.id}
  `;
  return { ok: true, customerId: account.id };
}
