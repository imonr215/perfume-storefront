"use client";

import { useEffect } from "react";
import { recordProductView } from "@/lib/actions/recently-viewed";

/** Renders nothing -- just fires the "you looked at this" server action
 *  once per mount. Split into its own tiny client component rather than
 *  making the whole detail page a client component for one side effect. */
export function RecordView({ sku }: { sku: string }) {
  useEffect(() => {
    recordProductView(sku).catch(() => {
      // Best-effort: a failed write here shouldn't affect the page.
    });
  }, [sku]);

  return null;
}
