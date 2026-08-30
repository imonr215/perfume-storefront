import type { MetadataRoute } from "next";

/**
 * Auto-served at /manifest.webmanifest and linked into <head> automatically
 * by this Next.js file convention -- no manual <link rel="manifest"> needed.
 *
 * Exists specifically for the kiosk iPad/Android tablet work: "Add to Home
 * Screen" only launches full-screen with zero browser chrome (no address
 * bar, no tabs -- indistinguishable from a native app) when a manifest like
 * this is present. That's the piece that makes each device's own lock
 * feature (iOS Guided Access, Android Screen Pinning) actually useful here --
 * without it, "Add to Home Screen" still shows the full browser UI, and a
 * customer can back out to Safari/Chrome chrome that a lock feature can't
 * hide on its own. See root CLAUDE.md's kiosk section for the full
 * per-device setup.
 *
 * display: "standalone" rather than "fullscreen" -- fullscreen hides the
 * OS status bar too, which is a slightly more aggressive kiosk look but
 * loses the clock/battery readout a shop employee glancing at the device
 * might actually want; standalone already removes all browser chrome,
 * which is the part that matters for stopping a customer from navigating
 * away.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Perfumery at The Fashion District",
    short_name: "The Fashion District",
    description: "Browse the shelf, find your scent, and pay at our kiosk.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7e9d2",
    theme_color: "#14343a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
