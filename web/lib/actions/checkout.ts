"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { createSession, getSession, hashPassword } from "@/lib/auth";
import { clearCart, getCart, readCartId } from "@/lib/cart";
import { findOrCreateCloverCustomer, cloverApiErrors } from "@/lib/clover";
import { isValidEmail } from "@/lib/validate";

export type CheckoutState = { error: string } | undefined;

/** Reuses the Clover customer already linked to this account, if any, and
 *  attaches one lazily on first order otherwise. */
async function resolveCloverCustomerForAccount(
  customerId: string,
  email: string,
  name: string
): Promise<string> {
  const rows = await sql<{ clover_customer_id: string | null }[]>`
    SELECT clover_customer_id FROM store_customers WHERE id = ${customerId}
  `;
  const existing = rows[0]?.clover_customer_id;
  if (existing) return existing;

  const cloverCustomerId = await findOrCreateCloverCustomer(email, name);
  await sql`
    UPDATE store_customers SET clover_customer_id = ${cloverCustomerId}, updated_at = now()
    WHERE id = ${customerId}
  `;
  return cloverCustomerId;
}

export async function checkoutAction(
  _prev: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  // Unlike the old Square flow, the charge has ALREADY happened by the time
  // this runs -- the client connected to the kiosk's Flex device via
  // web/lib/clover-connector.ts and completed a real sale before ever
  // calling this action. This action's job is to validate and record that
  // completed payment, not to initiate one.
  const cloverPaymentId = String(formData.get("cloverPaymentId") ?? "");
  const cloverExternalId = String(formData.get("cloverExternalId") ?? "");
  const cloverAmountCentsRaw = formData.get("cloverAmountCents");
  const chargedAmountCents =
    cloverAmountCentsRaw != null && cloverAmountCentsRaw !== ""
      ? Number(cloverAmountCentsRaw)
      : null;
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim().toLowerCase();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const createAccount = formData.get("createAccount") === "on";
  const newPassword = String(formData.get("newPassword") ?? "");

  if (!cloverPaymentId) return { error: "Payment didn't come through. Please try again." };
  if (!contactName) return { error: "Enter the name for this order." };
  if (!isValidEmail(contactEmail)) return { error: "Enter a valid email address." };
  if (!contactPhone) return { error: "Enter a phone number so we can reach you when it's ready." };

  const session = await getSession();
  if (!session && createAccount && newPassword.length < 8) {
    return { error: "Choose a password of at least 8 characters to save an account." };
  }

  const cartId = await readCartId();
  const items = await getCart();
  if (!cartId || items.length === 0) return { error: "Your cart is empty." };

  const unavailable = items.find((item) => !item.is_active);
  if (unavailable) {
    return { error: `${unavailable.product_name} is no longer available. Remove it from your cart.` };
  }

  // Re-read prices fresh from the catalog rather than trusting the cart
  // join above -- still worth doing even though payment already happened,
  // as a sanity check against a stale/manipulated cart total reaching the
  // terminal in the first place (the amount sent to the device is computed
  // from this same cart on the client, moments earlier).
  const skus = items.map((item) => item.sku);
  const products = await sql<
    { sku: string; price_cents: number | null; product_name: string; brand: string }[]
  >`
    SELECT sku, price_cents, product_name, brand
    FROM dim_products
    WHERE sku = ANY(${skus})
  `;
  const bySku = new Map(products.map((p) => [p.sku, p]));

  let subtotalCents = 0;
  for (const item of items) {
    const product = bySku.get(item.sku);
    if (!product || product.price_cents == null) {
      return { error: `${item.product_name} can't be ordered online right now.` };
    }
    subtotalCents += product.price_cents * item.quantity;
  }

  // The charge on the card is already final and irreversible from here --
  // the terminal ran it moments ago, on the amount computed when the
  // checkout page loaded. If a price changed between that page load and
  // this submission, `subtotalCents` (recomputed fresh, above) and
  // `chargedAmountCents` (what actually left the customer's card) can
  // disagree. There's nothing to roll back at this point, so this can't
  // block the order -- but recording the freshly-recomputed number as if
  // it were what was paid would silently paper over a real mismatch.
  // `total_cents` reflects what was actually charged; `subtotal_cents`
  // stays the catalog figure, so a mismatch between the two columns is
  // itself the audit trail for whoever reconciles it.
  if (chargedAmountCents != null && chargedAmountCents !== subtotalCents) {
    console.error(
      `[checkout] charged/catalog amount mismatch for payment ${cloverPaymentId}: ` +
        `terminal charged ${chargedAmountCents}c, catalog total is ${subtotalCents}c. ` +
        `Recording the charged amount; needs manual reconciliation.`
    );
  }
  const totalCents = chargedAmountCents ?? subtotalCents;

  let orderId: string;
  try {
    const cloverCustomerId = session
      ? await resolveCloverCustomerForAccount(session.id, contactEmail, contactName)
      : await findOrCreateCloverCustomer(contactEmail, contactName);

    const orderRows = await sql<{ id: string }[]>`
      INSERT INTO store_orders (
        customer_id, guest_email, clover_order_id, clover_payment_id, status,
        subtotal_cents, total_cents, contact_name, contact_email, contact_phone
      ) VALUES (
        ${session?.id ?? null}, ${session ? null : contactEmail}, ${cloverExternalId}, ${cloverPaymentId}, 'paid',
        ${subtotalCents}, ${totalCents}, ${contactName}, ${contactEmail}, ${contactPhone}
      )
      RETURNING id
    `;
    orderId = orderRows[0].id;

    for (const item of items) {
      const product = bySku.get(item.sku)!;
      await sql`
        INSERT INTO store_order_items (order_id, sku, product_name, brand, unit_price_cents, quantity)
        VALUES (${orderId}, ${item.sku}, ${product.product_name}, ${product.brand}, ${product.price_cents}, ${item.quantity})
      `;
    }

    await clearCart(cartId);

    if (!session && createAccount) {
      const alreadyRegistered = await sql<{ id: string }[]>`
        SELECT id FROM store_customers WHERE email = ${contactEmail}
      `;
      if (!alreadyRegistered[0]) {
        const passwordHash = await hashPassword(newPassword);
        const createdRows = await sql<{ id: string }[]>`
          INSERT INTO store_customers (email, password_hash, name, clover_customer_id)
          VALUES (${contactEmail}, ${passwordHash}, ${contactName}, ${cloverCustomerId})
          RETURNING id
        `;
        const newCustomerId = createdRows[0].id;
        await sql`
          UPDATE store_orders SET customer_id = ${newCustomerId}, guest_email = NULL WHERE id = ${orderId}
        `;
        await createSession(newCustomerId);
      }
      // If the email is already registered, we leave the order as a guest
      // order rather than silently attaching it to someone else's account.
    }
  } catch (err) {
    const cloverErrors = cloverApiErrors(err);
    if (cloverErrors) {
      return {
        error: cloverErrors[0]?.detail ?? "Something went wrong recording your order. Please try again.",
      };
    }
    console.error("[checkout] failed", err);
    return { error: "Something went wrong placing your order. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect(`/order/${orderId}`);
}
