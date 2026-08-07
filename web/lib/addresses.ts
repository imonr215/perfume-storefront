import { sql } from "@/lib/db";

export type Address = {
  id: string;
  label: string | null;
  recipient_name: string;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
};

export type AddressInput = {
  label: string | null;
  recipientName: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const ADDRESS_COLUMNS = sql`
  id, label, recipient_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default
`;

export async function getAddresses(customerId: string): Promise<Address[]> {
  return sql<Address[]>`
    SELECT ${ADDRESS_COLUMNS}
    FROM store_customer_addresses
    WHERE customer_id = ${customerId}
    ORDER BY is_default DESC, created_at
  `;
}

export async function getDefaultAddress(customerId: string): Promise<Address | null> {
  const rows = await sql<Address[]>`
    SELECT ${ADDRESS_COLUMNS}
    FROM store_customer_addresses
    WHERE customer_id = ${customerId} AND is_default
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getAddress(customerId: string, addressId: string): Promise<Address | null> {
  const rows = await sql<Address[]>`
    SELECT ${ADDRESS_COLUMNS}
    FROM store_customer_addresses
    WHERE customer_id = ${customerId} AND id = ${addressId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** First saved address always becomes the default, regardless of the checkbox --
 *  there's no such thing as "no default" once at least one address exists. */
export async function createAddress(
  customerId: string,
  input: AddressInput,
  makeDefault: boolean
): Promise<string> {
  return sql.begin(async (tx) => {
    const existing = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM store_customer_addresses WHERE customer_id = ${customerId}
    `;
    const shouldBeDefault = makeDefault || existing[0].count === 0;
    if (shouldBeDefault) {
      await tx`UPDATE store_customer_addresses SET is_default = FALSE WHERE customer_id = ${customerId}`;
    }
    const rows = await tx<{ id: string }[]>`
      INSERT INTO store_customer_addresses (
        customer_id, label, recipient_name, phone,
        address_line1, address_line2, city, state, postal_code, country, is_default
      ) VALUES (
        ${customerId}, ${input.label}, ${input.recipientName}, ${input.phone},
        ${input.addressLine1}, ${input.addressLine2}, ${input.city}, ${input.state}, ${input.postalCode}, ${input.country},
        ${shouldBeDefault}
      )
      RETURNING id
    `;
    return rows[0].id;
  });
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  input: AddressInput,
  makeDefault: boolean
): Promise<void> {
  await sql.begin(async (tx) => {
    if (makeDefault) {
      await tx`UPDATE store_customer_addresses SET is_default = FALSE WHERE customer_id = ${customerId}`;
    }
    await tx`
      UPDATE store_customer_addresses SET
        label = ${input.label},
        recipient_name = ${input.recipientName},
        phone = ${input.phone},
        address_line1 = ${input.addressLine1},
        address_line2 = ${input.addressLine2},
        city = ${input.city},
        state = ${input.state},
        postal_code = ${input.postalCode},
        country = ${input.country},
        is_default = CASE WHEN ${makeDefault} THEN TRUE ELSE is_default END,
        updated_at = now()
      WHERE id = ${addressId} AND customer_id = ${customerId}
    `;
  });
}

/** Deleting the default promotes the most recently added remaining address,
 *  if any -- an account with saved addresses should never be left with none
 *  marked default. */
export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const deleted = await tx<{ is_default: boolean }[]>`
      DELETE FROM store_customer_addresses
      WHERE id = ${addressId} AND customer_id = ${customerId}
      RETURNING is_default
    `;
    if (deleted[0]?.is_default) {
      await tx`
        UPDATE store_customer_addresses SET is_default = TRUE
        WHERE id = (
          SELECT id FROM store_customer_addresses
          WHERE customer_id = ${customerId}
          ORDER BY created_at DESC
          LIMIT 1
        )
      `;
    }
  });
}

export async function setDefaultAddress(customerId: string, addressId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE store_customer_addresses SET is_default = FALSE WHERE customer_id = ${customerId}`;
    await tx`
      UPDATE store_customer_addresses SET is_default = TRUE, updated_at = now()
      WHERE id = ${addressId} AND customer_id = ${customerId}
    `;
  });
}
