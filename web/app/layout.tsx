import type { Metadata } from "next";
import Link from "next/link";
import { Bitter, Karla } from "next/font/google";
import { getSession } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { logoutAction } from "@/lib/actions/auth";
import { removeFromCartAction } from "@/lib/actions/cart";
import { price } from "@/lib/products";
import { ProductPhoto } from "@/app/components/product-photo";
import { CartFlyout } from "@/app/components/cart-flyout";
import { CartBadgeLabel } from "@/app/components/cart-badge-label";
import { SubmitButton } from "@/app/components/submit-button";
import { CartCountProvider } from "@/lib/cart-context";
import { KioskIdleReset } from "@/app/components/kiosk-idle-reset";
import "./globals.css";

/* Bitter for display: a sturdy slab serif, warm rather than the
   high-contrast luxury serif every fragrance brand reaches for -- swapped in
   for Fraunces, whose lowercase "f" read too quirky for the brand. Karla for
   body: humanist, slightly quirky, easy at small sizes. */
const display = Bitter({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-display",
});

const body = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Perfumery at The Fashion District | fragrance counter",
  description:
    "A small fragrance counter. Browse the full shelf, find your scent, and reorder the one you already love.",
  // Older iOS specifically looks for apple-mobile-web-app-* meta tags
  // (rather than reading display: "standalone" out of manifest.ts) to
  // decide whether "Add to Home Screen" opens full-screen with no Safari
  // chrome -- part of the same kiosk iPad/tablet work as manifest.ts.
  // apple-touch-icon.png in /public is picked up automatically by iOS's
  // own convention (no explicit tag needed for that part).
  appleWebApp: {
    capable: true,
    title: "The Fashion District",
    statusBarStyle: "black-translucent",
  },
  // Confirmed live: this Next version's appleWebApp.capable only emits the
  // newer, unprefixed "mobile-web-app-capable" (Chrome/Android's name).
  // iOS/iPadOS specifically has only ever reliably honored the older
  // "apple-" prefixed tag for whether Add to Home Screen opens standalone
  // (no Safari chrome) vs. as a regular bookmark -- exactly the behavior
  // this whole manifest/meta-tag pass exists for on the iPad. Added
  // explicitly via `other` since there's no dedicated Metadata field for
  // it in this version.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [session, cartItems] = await Promise.all([getSession(), getCart()]);
  const count = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCents = cartItems.reduce(
    (sum, item) => sum + (item.price_cents ?? 0) * item.quantity,
    0
  );

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {/* Wraps the header AND the page content -- "Add to cart" forms
            live in {children} and need the same bump() the badge reads
            from (see lib/cart-context.tsx). serverCount is the real,
            per-render count from getCart() above; the provider re-syncs
            to it on every render, so an optimistic bump just gets
            confirmed once the actual round trip finishes. */}
        <CartCountProvider serverCount={count}>
          <KioskIdleReset />
          <header className="masthead">
            <div className="wrap masthead-inner">
              <Link href="/" className="wordmark">
                <span>Perfumery</span> at The Fashion District
              </Link>
              <nav className="site-nav" aria-label="Account and cart">
                {session ? (
                  <>
                    <Link href="/account">{session.name || "Account"}</Link>
                    <form action={logoutAction} className="site-nav-logout">
                      <button type="submit">Log out</button>
                    </form>
                  </>
                ) : (
                  <Link href="/login">Log in</Link>
                )}
                {/* Same <details> dropdown pattern as the search filters --
                    the panel's links work whether or not JS has loaded, and
                    it opens over the page instead of navigating straight to
                    /cart. CartFlyout is a thin client wrapper that just
                    closes it on navigation (see that file for why). */}
                <CartFlyout>
                  <summary className="cart-flyout-toggle site-nav-cart">
                    <CartBadgeLabel />
                  </summary>
                  <div className="cart-flyout-panel">
                    {cartItems.length === 0 ? (
                      <p className="cart-flyout-empty">
                        Nothing in your cart yet.
                      </p>
                    ) : (
                      <>
                        <ul className="cart-flyout-list">
                          {cartItems.map((item) => (
                            <li className="cart-flyout-row" key={item.sku}>
                              <ProductPhoto
                                sku={item.sku}
                                brand={item.brand}
                                family={item.scent_family}
                                variant="flyout"
                                className="cart-flyout-glyph"
                                imageUrl={item.image_url}
                                imageTransparentUrl={item.image_transparent_url}
                              />
                              <div className="cart-flyout-info">
                                <p className="cart-flyout-name">{item.product_name}</p>
                                <p className="cart-flyout-qty">Qty {item.quantity}</p>
                              </div>
                              <p className="cart-flyout-price">
                                {price((item.price_cents ?? 0) * item.quantity)}
                              </p>
                              <form action={removeFromCartAction}>
                                <input type="hidden" name="sku" value={item.sku} />
                                <SubmitButton className="cart-flyout-remove" pendingLabel="…">
                                  <span aria-hidden="true">×</span>
                                  <span className="sr-only">Remove {item.product_name}</span>
                                </SubmitButton>
                              </form>
                            </li>
                          ))}
                        </ul>
                        <div className="cart-flyout-summary">
                          <span>Subtotal</span>
                          <span>{price(subtotalCents)}</span>
                        </div>
                      </>
                    )}
                    {/* Cart page only, not a Checkout shortcut here -- this
                        preview never re-checks stock/pricing, so it shouldn't
                        be a launch pad straight into payment. */}
                    <div className="cart-flyout-actions">
                      <Link href="/cart" className="cart-flyout-view">
                        View cart
                      </Link>
                    </div>
                  </div>
                </CartFlyout>
              </nav>
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <div className="wrap site-footer-inner">
              {/* Storefront address, standard-website style -- same
                  address as the Terms page's registered mailing address
                  (kept in sync deliberately: one physical location, no
                  reason for two addresses to disagree). */}
              <div className="site-footer-about">
                <p className="site-footer-name">Perfumery at The Fashion District</p>
                <p className="site-footer-address">Address: 901 Market St, Philadelphia, PA 19107</p>
                <p className="site-footer-copyright">© 2026 Perfumery at The Fashion District</p>
              </div>
              <nav aria-label="Legal">
                <Link href="/terms">Terms of Service</Link>
                <Link href="/privacy">Privacy Policy</Link>
                <Link href="/refunds">Refund Policy</Link>
              </nav>
            </div>
          </footer>
        </CartCountProvider>
      </body>
    </html>
  );
}
