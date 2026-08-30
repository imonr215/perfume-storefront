"use client";

import { useEffect } from "react";
import { resetKioskSessionAction } from "@/lib/actions/kiosk";

const KIOSK_MODE_KEY = "kioskMode";
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Auto-resets the cart and any signed-in session after a few minutes of no
 * interaction -- but ONLY on a browser that's ever loaded this site with
 * ?kiosk=1 in the URL. That sets a localStorage flag once, remembered
 * forever after on that device -- this is meant to be visited exactly
 * once, when the store's own iPad is first set up (bookmarked/opened to
 * that URL), not something a real customer's own phone (arriving via the
 * kiosk's QR code, at the plain URL) would ever hit. Without that gate,
 * this would also silently log out and empty the cart of someone quietly
 * reading a product page on their own phone for a few minutes -- exactly
 * the opposite of what a personal device should do.
 *
 * Why this exists at all: unlike a phone, the iPad is a SHARED walk-up
 * device. If customer A adds items to cart (or logs in) and walks away
 * mid-browse, customer B who picks it up next would otherwise inherit A's
 * cart, or worse, A's still-logged-in account -- order history, saved
 * addresses, wishlist, all exposed to a stranger at a mall kiosk.
 *
 * Deliberately reads window.location directly rather than useSearchParams
 * (which would force a Suspense boundary here for no real benefit) --
 * kiosk mode only ever needs to be armed once per device, not tracked
 * reactively across client-side navigations.
 */
export function KioskIdleReset() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("kiosk") === "1") {
      try {
        localStorage.setItem(KIOSK_MODE_KEY, "1");
      } catch {
        // Private browsing / storage blocked -- kiosk mode just won't
        // persist across a reload in that case, not worth failing over.
      }
    }

    let kioskMode = false;
    try {
      kioskMode = localStorage.getItem(KIOSK_MODE_KEY) === "1";
    } catch {
      kioskMode = false;
    }
    if (!kioskMode) return;

    let timer: ReturnType<typeof setTimeout>;

    function arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Never reset out from under a payment in progress: after tapping
        // "Pay at kiosk & place order", the customer is standing at the
        // separate Flex device tapping their card, not touching the iPad
        // at all -- for up to SALE_TIMEOUT_MS (see lib/clover-connector.ts).
        // Re-arm instead of resetting until they leave /checkout, either by
        // finishing (redirected to /order/[id]) or backing out.
        if (window.location.pathname.startsWith("/checkout")) {
          arm();
          return;
        }
        resetKioskSessionAction();
      }, IDLE_TIMEOUT_MS);
    }

    const events = ["pointerdown", "touchstart", "keydown", "scroll"] as const;
    for (const event of events) {
      window.addEventListener(event, arm, { passive: true });
    }
    arm();

    return () => {
      clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, arm);
      }
    };
  }, []);

  return null;
}
