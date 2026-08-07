"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyLogin } from "@/lib/auth";
import { mergeGuestCartIntoCustomer, peekCartCookie } from "@/lib/cart";
import { isUniqueViolation, isValidEmail } from "@/lib/validate";

export type FormState = { error: string } | undefined;

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!isValidEmail(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  let customerId: string;
  try {
    const passwordHash = await hashPassword(password);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO store_customers (email, password_hash, name)
      VALUES (${email}, ${passwordHash}, ${name || null})
      RETURNING id
    `;
    customerId = rows[0].id;
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "An account with that email already exists." };
    throw err;
  }

  const guestCartId = await peekCartCookie();
  await createSession(customerId);
  await mergeGuestCartIntoCustomer(customerId, guestCartId);

  redirect("/account");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const result = await verifyLogin(email, password);
  if (!result.ok) {
    return {
      error:
        result.error === "locked"
          ? "Too many failed attempts. Try again in 15 minutes."
          : "Incorrect email or password.",
    };
  }

  const guestCartId = await peekCartCookie();
  await createSession(result.customerId);
  await mergeGuestCartIntoCustomer(result.customerId, guestCartId);

  redirect("/account");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/");
}
