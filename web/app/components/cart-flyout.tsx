"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin client wrapper around the <details> cart dropdown.
 *
 * The header lives in the root layout, which Next.js keeps mounted across
 * navigations rather than remounting it per page -- so a plain <details>
 * would carry its `open` state from whatever page it was last toggled on
 * into the next one. This closes it on every pathname change instead.
 * Everything inside (summary, panel, links, forms) stays server-rendered;
 * only the open/close behavior needs to run in the browser.
 */
export function CartFlyout({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details className="cart-flyout" ref={ref}>
      {children}
    </details>
  );
}
