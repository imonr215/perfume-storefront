"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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

  const cardRef = useRef<SquareCard | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadScript(): Promise<void> {
      if (window.Square) return;
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SQUARE_JS_SRC;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("failed to load square.js"));
        document.body.appendChild(script);
      });
    }

    async function init() {
      const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
      const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
      if (!appId || !locationId) {
        setCardStatus("error");
        return;
      }
      try {
        await loadScript();
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
        if (!cancelled) setCardStatus("error");
      }
    }

    init();
    return () => {
      cancelled = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
    };
  }, []);

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
    formAction(formData);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="form checkout-form" noValidate>
      <input type="hidden" name="sourceId" />

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
          Phone (optional)
          <input name="contactPhone" type="tel" defaultValue={defaults.phone} />
        </label>
      </fieldset>

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
          <p className="field-error">Couldn&apos;t load the card form. Refresh and try again.</p>
        )}
      </fieldset>

      {(cardError || state?.error) && <p className="field-error">{cardError ?? state?.error}</p>}

      <button type="submit" className="buy" disabled={cardStatus !== "ready" || pending}>
        {pending ? "Placing order…" : "Pay & place order"}
      </button>
    </form>
  );
}
