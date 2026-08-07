"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import {
  createAddress,
  deleteAddress,
  setDefaultAddress,
  updateAddress,
  type AddressInput,
} from "@/lib/addresses";

export type AddressFormState = { error: string } | undefined;

function readAddressInput(formData: FormData): AddressInput | { error: string } {
  const recipientName = String(formData.get("recipientName") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  const country = String(formData.get("country") ?? "US").trim() || "US";

  if (!recipientName || !addressLine1 || !city || !state || !postalCode) {
    return { error: "Fill in the full address." };
  }

  return {
    label: String(formData.get("label") ?? "").trim() || null,
    recipientName,
    phone: String(formData.get("phone") ?? "").trim() || null,
    addressLine1,
    addressLine2: String(formData.get("addressLine2") ?? "").trim() || null,
    city,
    state,
    postalCode,
    country,
  };
}

export async function addAddressAction(
  _prev: AddressFormState,
  formData: FormData
): Promise<AddressFormState> {
  const session = await getSession();
  if (!session) redirect("/login");

  const input = readAddressInput(formData);
  if ("error" in input) return input;

  await createAddress(session.id, input, formData.get("makeDefault") === "on");
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  redirect("/account/addresses");
}

export async function updateAddressAction(
  _prev: AddressFormState,
  formData: FormData
): Promise<AddressFormState> {
  const session = await getSession();
  if (!session) redirect("/login");

  const addressId = String(formData.get("addressId") ?? "");
  if (!addressId) return { error: "Missing address." };

  const input = readAddressInput(formData);
  if ("error" in input) return input;

  await updateAddress(session.id, addressId, input, formData.get("makeDefault") === "on");
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  redirect("/account/addresses");
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");

  const addressId = String(formData.get("addressId") ?? "");
  if (!addressId) return;

  await deleteAddress(session.id, addressId);
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");

  const addressId = String(formData.get("addressId") ?? "");
  if (!addressId) return;

  await setDefaultAddress(session.id, addressId);
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
}
