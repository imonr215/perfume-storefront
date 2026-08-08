"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { createSession, getSession, hashPassword } from "@/lib/auth";
import { clearCart, getCart, readCartId } from "@/lib/cart";
import { createAddress } from "@/lib/addresses";
import {
  createOrderAndPayment,
  findOrCreateSquareCustomer,
  SquareError,
  type ShippingRecipient,
  type SquareLineItem,
} from "@/lib/square";
import { isValidEmail } from "@/lib/validate";

export type CheckoutState = { error: string } | undefined;

type ShippingAddress = {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

/** Reuses the Square customer already linked to this account, if any, and
 *  attaches one lazily on first order otherwise. */
async function resolveSquareCustomerForAccount(
  customerId: string,
  email: string,
  name: string
): Promise<string> {
  const rows = await sql<{ square_customer_id: string | null }[]>`
    SELECT square_customer_id FROM store_customers WHERE id = ${customerId}
  `;
  const existing = rows[0]?.square_customer_id;
  if (existing) return existing;

  const squareCustomerId = await findOrCreateSquareCustomer(email, name);
  await sql`
    UPDATE store_customers SET square_customer_id = ${squareCustomerId}, updated_at = now()
    WHERE id = ${customerId}
  `;
  return squareCustomerId;
}

export async function checkoutAction(
  _prev: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  const sourceId = String(formData.get("sourceId") ?? "");
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim().toLowerCase();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const addressLine2 = String(formData.get("addressLine2") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  const country = String(formData.get("country") ?? "US").trim() || "US";
  const createAccount = formData.get("createAccount") === "on";
  const newPassword = String(formData.get("newPassword") ?? "");

  if (!sourceId) return { error: "Card details didn't come through. Please try again." };
  if (!contactName) return { error: "Enter the name for this order." };
  if (!isValidEmail(contactEmail)) return { error: "Enter a valid email address." };
  if (!addressLine1 || !city || !state || !postalCode) {
    return { error: "Fill in the full shipping address." };
  }

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

  // Re-read prices and Square variation ids fresh from the catalog rather
  // than trusting the cart join above -- a price change between "add to
  // cart" and "pay" must not charge the old number.
  const skus = items.map((item) => item.sku);
  const products = await sql<
    {
      sku: string;
      square_variation_id: string | null;
      price_cents: number | null;
      product_name: string;
      brand: string;
    }[]
  >`
    SELECT sku, square_variation_id, price_cents, product_name, brand
    FROM dim_products
    WHERE sku = ANY(${skus})
  `;
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const lineItems: SquareLineItem[] = [];
  let subtotalCents = 0;
  for (const item of items) {
    const product = bySku.get(item.sku);
    if (!product?.square_variation_id || product.price_cents == null) {
      return { error: `${item.product_name} can't be ordered online right now.` };
    }
    subtotalCents += product.price_cents * item.quantity;
    lineItems.push({
      catalogObjectId: product.square_variation_id,
      quantity: item.quantity,
      name: `${product.brand} ${product.product_name}`,
    });
  }

  const shippingAddress: ShippingAddress = {
    addressLine1,
    addressLine2: addressLine2 || null,
    city,
    state,
    postalCode,
    country,
  };

  const shipping: ShippingRecipient = {
    displayName: contactName,
    emailAddress: contactEmail,
    phoneNumber: contactPhone || undefined,
    address: {
      addressLine1,
      addressLine2: addressLine2 || null,
      locality: city,
      administrativeDistrictLevel1: state,
      postalCode,
      country,
    },
  };

  let orderId: string;
  try {
    const squareCustomerId = session
      ? await resolveSquareCustomerForAccount(session.id, contactEmail, contactName)
      : await findOrCreateSquareCustomer(contactEmail, contactName);

    const { squareOrderId, squarePaymentId, totalCents } = await createOrderAndPayment({
      items: lineItems,
      sourceId,
      customerId: squareCustomerId,
      buyerEmail: contactEmail,
      shipping,
    });

    const orderRows = await sql<{ id: string }[]>`
      INSERT INTO store_orders (
        customer_id, guest_email, square_order_id, square_payment_id, status,
        subtotal_cents, total_cents, contact_name, contact_email, contact_phone, shipping_address
      ) VALUES (
        ${session?.id ?? null}, ${session ? null : contactEmail}, ${squareOrderId}, ${squarePaymentId}, 'paid',
        ${subtotalCents}, ${totalCents}, ${contactName}, ${contactEmail}, ${contactPhone || null},
        ${sql.json(shippingAddress)}
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
          INSERT INTO store_customers (email, password_hash, name, square_customer_id)
          VALUES (${contactEmail}, ${passwordHash}, ${contactName}, ${squareCustomerId})
          RETURNING id
        `;
        const newCustomerId = createdRows[0].id;
        await sql`
          UPDATE store_orders SET customer_id = ${newCustomerId}, guest_email = NULL WHERE id = ${orderId}
        `;
        await createAddress(
          newCustomerId,
          {
            label: null,
            recipientName: contactName,
            phone: contactPhone || null,
            addressLine1,
            addressLine2: addressLine2 || null,
            city,
            state,
            postalCode,
            country,
          },
          true
        );
        await createSession(newCustomerId);
      }
      // If the email is already registered, we leave the order as a guest
      // order rather than silently attaching it to someone else's account.
    }
  } catch (err) {
    if (err instanceof SquareError) {
      return {
        error:
          err.errors?.[0]?.detail ??
          "The payment didn't go through. Please check your card and try again.",
      };
    }
    console.error("[checkout] failed", err);
    return { error: "Something went wrong placing your order. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect(`/order/${orderId}`);
}
