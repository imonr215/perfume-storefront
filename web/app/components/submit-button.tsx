"use client";

import { useFormStatus } from "react-dom";

/**
 * Drop-in replacement for a plain <button type="submit"> inside a Server
 * Action form -- shows a pending state instead of just sitting inert until
 * the action resolves and the page re-renders. Must be a child of the
 * <form> it reports on (useFormStatus reads the nearest parent form), so
 * the enclosing page can stay a Server Component; only this button itself
 * needs to be a Client Component.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? "…") : children}
    </button>
  );
}
