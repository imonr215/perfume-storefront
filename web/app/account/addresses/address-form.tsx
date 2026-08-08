"use client";

import { useActionState } from "react";
import type { AddressFormState } from "@/lib/actions/addresses";

type Defaults = {
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
};

export function AddressForm({
  action,
  defaults,
  addressId,
  submitLabel,
}: {
  action: (prevState: AddressFormState, formData: FormData) => Promise<AddressFormState>;
  defaults?: Partial<Defaults>;
  addressId?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<AddressFormState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="form">
      {addressId && <input type="hidden" name="addressId" value={addressId} />}

      <label>
        Label (optional)
        <input name="label" defaultValue={defaults?.label} placeholder="Home, Work…" />
      </label>
      <label>
        Recipient name
        <input name="recipientName" defaultValue={defaults?.recipientName} required />
      </label>
      <label>
        Phone (optional)
        <input name="phone" type="tel" defaultValue={defaults?.phone} />
      </label>
      <label>
        Address line 1
        <input name="addressLine1" defaultValue={defaults?.addressLine1} required />
      </label>
      <label>
        Address line 2 (optional)
        <input name="addressLine2" defaultValue={defaults?.addressLine2} />
      </label>
      <label>
        City
        <input name="city" defaultValue={defaults?.city} required />
      </label>
      <label>
        State / province
        <input name="state" defaultValue={defaults?.state} required />
      </label>
      <label>
        Postal code
        <input name="postalCode" defaultValue={defaults?.postalCode} required />
      </label>
      <label>
        Country
        <input name="country" defaultValue={defaults?.country || "US"} required />
      </label>
      <label className="checkout-checkbox">
        <input type="checkbox" name="makeDefault" defaultChecked={defaults?.isDefault} />
        Make this my default address
      </label>

      {state?.error && <p className="field-error">{state.error}</p>}

      <button type="submit" className="buy" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
