"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signupAction, type FormState } from "@/lib/actions/auth";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    signupAction,
    undefined
  );

  return (
    <form action={formAction} className="form auth-form">
      <label>
        Name
        <input name="name" autoComplete="name" />
      </label>
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>

      {state?.error && <p className="field-error">{state.error}</p>}

      <button type="submit" className="buy" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>

      <p className="auth-switch">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
