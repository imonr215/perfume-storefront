"use client";

import { useEffect } from "react";

/**
 * The family pills (see .families in app/page.tsx) live in a horizontally
 * scrolling row, and each pill's a plain <button type="submit"> in a
 * method="GET" <form> -- so picking one is a real browser navigation, not a
 * Next.js soft transition. That means every click reloads the page from
 * scratch, and the fresh DOM's scroll position starts back at 0 regardless
 * of which pill was clicked, even though it's marked data-active and may be
 * scrolled out of view. This runs once after that fresh mount and scrolls
 * the active pill into view instead of leaving the row reset to the left.
 */
export function ScrollActiveFamilyIntoView() {
  useEffect(() => {
    const active = document.querySelector<HTMLElement>('.families [data-active="true"]');
    active?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
  }, []);

  return null;
}
