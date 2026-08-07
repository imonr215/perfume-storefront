"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type FormState } from "@/lib/actions/auth";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(loginAction, undefined);

  return (
    <form action={formAction} className="form auth-form">
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input name="password" type="password" required autoComplete="current-password" />
      </label>

      {state?.error && <p className="field-error">{state.error}</p>}

      <button type="submit" className="buy" disabled={pending}>
        {pending ? "Signing in…" : "Log in"}
      </button>

      <p className="auth-switch">
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </form>
  );
}
