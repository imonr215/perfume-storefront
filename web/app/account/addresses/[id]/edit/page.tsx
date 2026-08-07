import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getAddress } from "@/lib/addresses";
import { updateAddressAction } from "@/lib/actions/addresses";
import { AddressForm } from "../../address-form";

export const dynamic = "force-dynamic";

export default async function EditAddressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const address = await getAddress(session.id, id);
  if (!address) notFound();

  return (
    <main className="wrap">
      <Link href="/account/addresses" className="back">
        ← Saved addresses
      </Link>
      <h1 className="page-title">Edit address</h1>

      <AddressForm
        action={updateAddressAction}
        addressId={address.id}
        submitLabel="Save changes"
        defaults={{
          label: address.label ?? "",
          recipientName: address.recipient_name,
          phone: address.phone ?? "",
          addressLine1: address.address_line1,
          addressLine2: address.address_line2 ?? "",
          city: address.city,
          state: address.state,
          postalCode: address.postal_code,
          country: address.country,
          isDefault: address.is_default,
        }}
      />
    </main>
  );
}
