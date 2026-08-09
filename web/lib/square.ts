import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment, type Square } from "square";

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

/**
 * Square's SDK throws a SquareError subclass on non-2xx responses, but
 * `instanceof SquareError` unreliably fails here -- Next's per-route
 * bundling loads a second copy of the "square" package, so the thrown
 * instance and the imported class aren't the same identity, and every
 * Square error (including plain card declines) silently falls through to a
 * generic catch-all instead of a real message. Duck-type the response shape
 * Square actually documents instead, which is robust to that.
 */
export function squareApiErrors(err: unknown): { detail?: string }[] | null {
  if (
    err &&
    typeof err === "object" &&
    "errors" in err &&
    Array.isArray((err as { errors: unknown }).errors)
  ) {
    return (err as { errors: { detail?: string }[] }).errors;
  }
  return null;
}

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

export type PickupRecipient = {
  displayName: string;
  emailAddress: string;
  phoneNumber?: string;
};

export type Fulfillment =
  | { type: "SHIPMENT"; shipping: ShippingRecipient }
  | { type: "PICKUP"; pickup: PickupRecipient };

function buildFulfillment(fulfillment: Fulfillment) {
  if (fulfillment.type === "PICKUP") {
    return {
      type: "PICKUP" as const,
      pickupDetails: {
        recipient: {
          displayName: fulfillment.pickup.displayName,
          emailAddress: fulfillment.pickup.emailAddress,
          phoneNumber: fulfillment.pickup.phoneNumber,
        },
        // No scheduled-pickup-time picker yet -- every pickup order is
        // "ready as soon as we can get to it", with prepTimeDuration just
        // informational (shown in Square's own dashboard/POS).
        scheduleType: "ASAP" as const,
        prepTimeDuration: "PT30M",
      },
    };
  }
  return {
    type: "SHIPMENT" as const,
    shipmentDetails: {
      recipient: {
        displayName: fulfillment.shipping.displayName,
        emailAddress: fulfillment.shipping.emailAddress,
        phoneNumber: fulfillment.shipping.phoneNumber,
        address: {
          addressLine1: fulfillment.shipping.address.addressLine1,
          addressLine2: fulfillment.shipping.address.addressLine2 ?? undefined,
          locality: fulfillment.shipping.address.locality,
          administrativeDistrictLevel1: fulfillment.shipping.address.administrativeDistrictLevel1,
          postalCode: fulfillment.shipping.address.postalCode,
          // Free-text on our end (see checkout form); Square's type is
          // a closed ISO-3166 union, so this is a deliberate widen.
          country: fulfillment.shipping.address.country as Square.Country,
        },
      },
    },
  };
}

export async function createOrderAndPayment(params: {
  items: SquareLineItem[];
  sourceId: string;
  customerId?: string;
  buyerEmail: string;
  fulfillment: Fulfillment;
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
      fulfillments: [buildFulfillment(params.fulfillment)],
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
