import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Karla } from "next/font/google";
import { getSession } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { logoutAction } from "@/lib/actions/auth";
import { removeFromCartAction } from "@/lib/actions/cart";
import { price } from "@/lib/products";
import { BottleGlyph } from "@/app/components/bottle-glyph";
import { CartFlyout } from "@/app/components/cart-flyout";
import { CartBadgeLabel } from "@/app/components/cart-badge-label";
import { SubmitButton } from "@/app/components/submit-button";
import { CartCountProvider } from "@/lib/cart-context";
import "./globals.css";

/* Fraunces for display: a soft optical serif — warm and handmade rather than
   the high-contrast luxury serif every fragrance brand reaches for. Karla for
   body: humanist, slightly quirky, easy at small sizes. */
const display = Fraunces({
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
  title: "Bloom & Basin — fragrance counter",
  description:
    "A small fragrance counter. Browse the full shelf, find your scent, and reorder the one you already love.",
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
          <header className="masthead">
            <div className="wrap masthead-inner">
              <Link href="/" className="wordmark">
                Bloom <span>&amp;</span> Basin
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
                              <BottleGlyph
                                sku={item.sku}
                                brand={item.brand}
                                family={item.scent_family}
                                variant="flyout"
                                className="cart-flyout-glyph"
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
              <p>© 2026 Bloom &amp; Basin</p>
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
