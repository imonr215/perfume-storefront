"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/lib/actions/checkout";
import { createCloverConnector, type SaleResult } from "@/lib/clover-connector";

type Defaults = {
  name: string;
  email: string;
  phone: string;
};

type CloverConfig = {
  merchantId: string;
  deviceId: string;
  accessToken: string;
  remoteApplicationId: string;
};

/**
 * No card fields here at all -- payment happens live on the kiosk's Flex
 * device via Clover's Remote Pay Cloud SDK (web/lib/clover-connector.ts),
 * not through an online tokenization form the way the old Square/Ecommerce
 * flow worked. Pickup is the only fulfillment method (see root CLAUDE.md):
 * remote-pay only works when the customer is physically at the device, so
 * shipping doesn't make sense here anymore.
 *
 * This can only be exercised up to the "connecting to the terminal" state
 * without real hardware -- there's no sandbox simulator for Remote Pay
 * Cloud (confirmed). See the migration plan's Phase 6/7 split.
 */
export function CheckoutForm({
  defaults,
  offerAccountCreation,
  paymentConfigured,
  clover,
  totalCents,
}: {
  defaults: Defaults;
  offerAccountCreation: boolean;
  paymentConfigured: boolean;
  clover: CloverConfig;
  totalCents: number;
}) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(
    checkoutAction,
    undefined
  );
  const [createAccount, setCreateAccount] = useState(false);
  const [payState, setPayState] = useState<
    "idle" | "connecting" | "waiting-for-terminal" | "failed"
  >("idle");
  const [payError, setPayError] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current || pending || payState === "connecting" || payState === "waiting-for-terminal") return;
    setPayError(null);

    if (!paymentConfigured) {
      setPayError("Checkout isn't available right now -- the kiosk terminal isn't configured.");
      return;
    }

    setPayState("connecting");
    const externalId = `web-${crypto.randomUUID()}`;

    const connector = createCloverConnector(clover);
    let result: SaleResult;
    try {
      await connector.connect();
      setPayState("waiting-for-terminal");
      result = await connector.sale(totalCents, externalId);
    } catch (err) {
      setPayState("failed");
      setPayError(err instanceof Error ? err.message : "Couldn't reach the terminal at the kiosk.");
      return;
    } finally {
      connector.disconnect();
    }

    if (!result.success) {
      setPayState("failed");
      setPayError(result.reason);
      return;
    }

    const formData = new FormData(formRef.current);
    formData.set("cloverPaymentId", result.paymentId);
    formData.set("cloverExternalId", externalId);
    // Same reasoning as the old Square flow's explicit startTransition: the
    // action is being called after an await (the sale round trip), outside
    // the synchronous scope React auto-wraps for a plain <form action={}>.
    // Without this, the action still runs and still records the order, but
    // useActionState's redirect() doesn't take effect.
    startTransition(() => {
      formAction(formData);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="form checkout-form" noValidate>
      <input type="hidden" name="cloverPaymentId" />
      <input type="hidden" name="cloverExternalId" />

      <fieldset>
        <legend>Pickup</legend>
        <p className="field-hint">
          Ready at our kiosk in about 30 minutes. You&apos;ll pay in person on the
          terminal there when you check out below.
        </p>
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
          Phone
          <input name="contactPhone" type="tel" defaultValue={defaults.phone} required />
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
        <legend>Payment</legend>
        {payState === "idle" && (
          <p className="field-hint">
            Card details never touch this site -- you&apos;ll tap or insert your
            card directly on our kiosk&apos;s terminal.
          </p>
        )}
        {payState === "connecting" && <p className="field-hint">Connecting to the kiosk terminal…</p>}
        {payState === "waiting-for-terminal" && (
          <p className="field-hint">
            Complete your payment on the terminal at the kiosk now. This can take
            up to a minute.
          </p>
        )}
        {!paymentConfigured && (
          <p className="field-error">
            Checkout isn&apos;t available right now -- please check back shortly.
          </p>
        )}
      </fieldset>

      {(payError || state?.error) && <p className="field-error">{payError ?? state?.error}</p>}

      <button
        type="submit"
        className="buy"
        disabled={!paymentConfigured || pending || payState === "connecting" || payState === "waiting-for-terminal"}
      >
        {payState === "waiting-for-terminal"
          ? "Waiting on terminal…"
          : pending
            ? "Placing order…"
            : "Pay at kiosk & place order"}
      </button>
    </form>
  );
}
