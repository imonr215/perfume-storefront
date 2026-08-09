"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/lib/actions/checkout";

type TokenizeResult = {
  status: string;
  token?: string;
  errors?: { message: string }[];
};

type SquareCard = {
  attach: (selector: string) => Promise<void>;
  destroy: () => Promise<void>;
  tokenize: () => Promise<TokenizeResult>;
};

type SquarePayments = {
  card: () => Promise<SquareCard>;
};

declare global {
  interface Window {
    Square?: { payments: (appId: string, locationId: string) => SquarePayments };
  }
}

const SQUARE_JS_SRC =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

// Module-level, not component state: shared across every mount so a client-side
// navigation away and back (or React Strict Mode's double effect run in dev)
// can't append a second <script> tag while the first is still in flight --
// Square's SDK does its own customElements.define() on load and throws if
// that runs twice. Reset to null on failure so the next attempt (a retry, or
// a fresh mount) starts a clean load instead of awaiting a script tag that
// already errored out and will never fire again.
let squareScriptLoadPromise: Promise<void> | null = null;

function loadSquareScript(): Promise<void> {
  if (window.Square) return Promise.resolve();
  if (squareScriptLoadPromise) return squareScriptLoadPromise;
  squareScriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SQUARE_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      squareScriptLoadPromise = null;
      reject(new Error("failed to load square.js"));
    };
    document.body.appendChild(script);
  });
  return squareScriptLoadPromise;
}

type Defaults = {
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export function CheckoutForm({
  defaults,
  offerAccountCreation,
}: {
  defaults: Defaults;
  offerAccountCreation: boolean;
}) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(
    checkoutAction,
    undefined
  );
  const [cardStatus, setCardStatus] = useState<"loading" | "ready" | "error">("loading");
  const [cardError, setCardError] = useState<string | null>(null);
  const [createAccount, setCreateAccount] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<"SHIPMENT" | "PICKUP">("SHIPMENT");
  const [retryNonce, setRetryNonce] = useState(0);

  const cardRef = useRef<SquareCard | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    setCardStatus("loading");

    // A single flaky attempt was the whole reason this failed intermittently --
    // one dropped request to Square's CDN, or a transient hiccup in
    // payments.card()/attach(), permanently tripped the error state with no
    // way back short of a full page refresh. Retry a few times with a short
    // backoff before actually giving up.
    const MAX_ATTEMPTS = 3;

    async function attempt(n: number) {
      const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
      const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
      if (!appId || !locationId) {
        setCardStatus("error");
        return;
      }
      try {
        await loadSquareScript();
        if (cancelled || !window.Square) throw new Error("Square SDK unavailable");
        const payments = window.Square.payments(appId, locationId);
        const card = await payments.card();
        await card.attach("#card-container");
        if (cancelled) {
          await card.destroy();
          return;
        }
        cardRef.current = card;
        setCardStatus("ready");
      } catch {
        if (cancelled) return;
        if (n < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 400 * n));
          if (!cancelled) await attempt(n + 1);
        } else {
          setCardStatus("error");
        }
      }
    }

    attempt(1);
    return () => {
      cancelled = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
    };
  }, [retryNonce]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cardRef.current || !formRef.current || pending) return;
    setCardError(null);

    const result = await cardRef.current.tokenize();
    if (result.status !== "OK" || !result.token) {
      setCardError(
        result.errors?.[0]?.message ?? "Card details didn't validate. Check them and try again."
      );
      return;
    }

    const formData = new FormData(formRef.current);
    formData.set("sourceId", result.token);
    // formAction is being called after an await (card.tokenize()), outside
    // the synchronous scope React auto-wraps in a transition for a plain
    // <form action={...}>. Without this explicit startTransition, the action
    // still runs and still charges the card server-side, but useActionState
    // can't apply its redirect() -- the order goes through with nothing on
    // screen telling the customer that happened. Confirmed live: a real
    // sandbox payment completed (status "paid", real Square order/payment
    // ids) while the browser sat on /checkout with no navigation and no error.
    startTransition(() => {
      formAction(formData);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="form checkout-form" noValidate>
      <input type="hidden" name="sourceId" />
      <input type="hidden" name="fulfillmentType" value={fulfillmentType} />

      <fieldset>
        <legend>How do you want it?</legend>
        <div className="fulfillment-toggle" role="group" aria-label="Fulfillment method">
          <button
            type="button"
            data-active={fulfillmentType === "SHIPMENT"}
            onClick={() => setFulfillmentType("SHIPMENT")}
          >
            Ship to me
          </button>
          <button
            type="button"
            data-active={fulfillmentType === "PICKUP"}
            onClick={() => setFulfillmentType("PICKUP")}
          >
            Pick up in store
          </button>
        </div>
        {fulfillmentType === "PICKUP" && (
          <p className="field-hint">Ready at our kiosk in about 30 minutes.</p>
        )}
      </fieldset>

      <fieldset>
        <legend>Contact</legend>
        <label>
          Full name
          <input name="contactName" defaultValue={defaults.name} required />
        </label>
        <label>
          Email
          <input name="contactEmail" type="email" defaultValue={defaults.email} required />
        </label>
        <label>
          {fulfillmentType === "PICKUP" ? "Phone" : "Phone (optional)"}
          <input
            name="contactPhone"
            type="tel"
            defaultValue={defaults.phone}
            required={fulfillmentType === "PICKUP"}
          />
        </label>
      </fieldset>

      {fulfillmentType === "SHIPMENT" && (
        <fieldset>
          <legend>Shipping address</legend>
          <label>
            Address line 1
            <input name="addressLine1" defaultValue={defaults.addressLine1} required />
          </label>
          <label>
            Address line 2 (optional)
            <input name="addressLine2" defaultValue={defaults.addressLine2} />
          </label>
          <label>
            City
            <input name="city" defaultValue={defaults.city} required />
          </label>
          <label>
            State / province
            <input name="state" defaultValue={defaults.state} required />
          </label>
          <label>
            Postal code
            <input name="postalCode" defaultValue={defaults.postalCode} required />
          </label>
          <label>
            Country
            <input name="country" defaultValue={defaults.country || "US"} required />
          </label>
        </fieldset>
      )}

      {offerAccountCreation && (
        <fieldset>
          <legend>Account</legend>
          <label className="checkout-checkbox">
            <input
              type="checkbox"
              name="createAccount"
              checked={createAccount}
              onChange={(event) => setCreateAccount(event.target.checked)}
            />
            Save these details and create an account
          </label>
          {createAccount && (
            <label>
              Password
              <input name="newPassword" type="password" minLength={8} required />
            </label>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>Card</legend>
        <div id="card-container" className="card-container" />
        {cardStatus === "error" && (
          <p className="field-error">
            Couldn&apos;t load the card form.{" "}
            <button
              type="button"
              className="field-error-retry"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              Try again
            </button>
          </p>
        )}
      </fieldset>

      {(cardError || state?.error) && <p className="field-error">{cardError ?? state?.error}</p>}

      <button type="submit" className="buy" disabled={cardStatus !== "ready" || pending}>
        {pending ? "Placing order…" : "Pay & place order"}
      </button>
    </form>
  );
}
