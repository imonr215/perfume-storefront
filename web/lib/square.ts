import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment, SquareError, type Square } from "square";

/**
 * One shared Square client, same globalThis-caching trick as lib/db.ts (dev
 * hot-reload would otherwise re-construct this, though it's cheap here --
 * kept for consistency).
 */
const globalForSquare = globalThis as unknown as { _square?: SquareClient };

function buildClient(): SquareClient {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set");

  const environment =
    (process.env.SQUARE_ENVIRONMENT ?? "sandbox").toLowerCase() === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  return new SquareClient({ token, environment });
}

export const squareClient = globalForSquare._square ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForSquare._square = squareClient;
}

export function squareLocationId(): string {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error("SQUARE_LOCATION_ID is not set");
  return id;
}

export { SquareError };

/**
 * Square is the customer system of record for anything order-related. We
 * search by email before creating so repeat guest checkouts (and a
 * customer's first order after signing up) attach to the same Square
 * customer instead of spawning duplicates.
 */
export async function findOrCreateSquareCustomer(
  email: string,
  name?: string | null
): Promise<string> {
  const search = await squareClient.customers.search({
    query: { filter: { emailAddress: { exact: email } } },
  });
  const existing = search.customers?.[0]?.id;
  if (existing) return existing;

  const [givenName, ...rest] = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const created = await squareClient.customers.create({
    emailAddress: email,
    givenName: givenName || undefined,
    familyName: rest.length ? rest.join(" ") : undefined,
  });
  if (!created.customer?.id) {
    throw new Error("Square did not return a customer id");
  }
  return created.customer.id;
}

export type SquareLineItem = {
  catalogObjectId: string;
  quantity: number;
  name: string;
};

/**
 * Creates the Square order, then pays it with the Web Payments SDK nonce.
 * Two calls, not one -- Square has no single "create and pay" order
 * endpoint -- but they share nothing that needs to roll back: an order with
 * no payment is just an abandoned open order, harmless to leave behind if
 * the payment call fails.
 */
export type ShippingRecipient = {
  displayName: string;
  emailAddress: string;
  phoneNumber?: string;
  address: {
    addressLine1: string;
    addressLine2?: string | null;
    locality: string;
    administrativeDistrictLevel1: string;
    postalCode: string;
    country: string;
  };
};

export async function createOrderAndPayment(params: {
  items: SquareLineItem[];
  sourceId: string;
  customerId?: string;
  buyerEmail: string;
  shipping: ShippingRecipient;
}): Promise<{ squareOrderId: string; squarePaymentId: string; totalCents: number }> {
  const locationId = squareLocationId();

  const orderResp = await squareClient.orders.create({
    idempotencyKey: randomUUID(),
    order: {
      locationId,
      customerId: params.customerId,
      lineItems: params.items.map((item) => ({
        catalogObjectId: item.catalogObjectId,
        quantity: String(item.quantity),
        name: item.name,
      })),
      // A single SHIPMENT fulfillment -- checkout only collects one shipping
      // address today, no pickup/delivery choice yet (see checkout action).
      fulfillments: [
        {
          type: "SHIPMENT",
          shipmentDetails: {
            recipient: {
              displayName: params.shipping.displayName,
              emailAddress: params.shipping.emailAddress,
              phoneNumber: params.shipping.phoneNumber,
              address: {
                addressLine1: params.shipping.address.addressLine1,
                addressLine2: params.shipping.address.addressLine2 ?? undefined,
                locality: params.shipping.address.locality,
                administrativeDistrictLevel1: params.shipping.address.administrativeDistrictLevel1,
                postalCode: params.shipping.address.postalCode,
                // Free-text on our end (see checkout form); Square's type is
                // a closed ISO-3166 union, so this is a deliberate widen.
                country: params.shipping.address.country as Square.Country,
              },
            },
          },
        },
      ],
    },
  });

  const order = orderResp.order;
  if (!order?.id || order.totalMoney?.amount == null) {
    throw new Error("Square order was created without an id/total");
  }

  const paymentResp = await squareClient.payments.create({
    idempotencyKey: randomUUID(),
    sourceId: params.sourceId,
    orderId: order.id,
    locationId,
    customerId: params.customerId,
    buyerEmailAddress: params.buyerEmail,
    amountMoney: {
      amount: order.totalMoney.amount,
      currency: order.totalMoney.currency ?? "USD",
    },
  });

  if (!paymentResp.payment?.id) {
    throw new Error("Square payment was created without an id");
  }

  return {
    squareOrderId: order.id,
    squarePaymentId: paymentResp.payment.id,
    totalCents: Number(order.totalMoney.amount),
  };
}
