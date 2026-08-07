import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getAddresses } from "@/lib/addresses";
import { addAddressAction, deleteAddressAction, setDefaultAddressAction } from "@/lib/actions/addresses";
import { AddressForm } from "./address-form";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const session = await requireSession();
  const addresses = await getAddresses(session.id);

  return (
    <main className="wrap">
      <Link href="/account" className="back">
        ← Account
      </Link>
      <h1 className="page-title">Saved addresses</h1>

      {addresses.length > 0 && (
        <ul className="address-list">
          {addresses.map((address) => (
            <li key={address.id} className="address-card">
              <div>
                {address.label && <p className="section-label">{address.label}</p>}
                <p className="detail-blurb account-card-name">{address.recipient_name}</p>
                <p className="spec">
                  {address.address_line1}
                  {address.address_line2 ? `, ${address.address_line2}` : ""}
                  <br />
                  {address.city}, {address.state} {address.postal_code}
                  <br />
                  {address.country}
                </p>
                {address.is_default && (
                  <p className="address-default-tag">Default</p>
                )}
              </div>
              <div className="address-actions">
                <Link href={`/account/addresses/${address.id}/edit`} className="cart-update">
                  Edit
                </Link>
                {!address.is_default && (
                  <form action={setDefaultAddressAction}>
                    <input type="hidden" name="addressId" value={address.id} />
                    <button type="submit" className="cart-update">
                      Make default
                    </button>
                  </form>
                )}
                <form action={deleteAddressAction}>
                  <input type="hidden" name="addressId" value={address.id} />
                  <button type="submit" className="cart-remove">
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="account-card address-form-card">
        <p className="section-label">
          {addresses.length === 0 ? "Add your first address" : "Add another address"}
        </p>
        <AddressForm action={addAddressAction} submitLabel="Save address" />
      </section>
    </main>
  );
}
