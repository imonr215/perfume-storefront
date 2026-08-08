import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Karla } from "next/font/google";
import { getSession } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { logoutAction } from "@/lib/actions/auth";
import { price } from "@/lib/products";
import { BottleGlyph } from "@/app/components/bottle-glyph";
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
              {/* Same zero-JS <details> dropdown pattern as the search
                  filters: the panel's links work whether or not JS has
                  loaded, and it opens over the page instead of navigating
                  straight to /cart so a peek at what's inside doesn't cost
                  a page load. */}
              <details className="cart-flyout">
                <summary className="cart-flyout-toggle site-nav-cart">
                  Cart{count > 0 ? ` (${count})` : ""}
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
                          </li>
                        ))}
                      </ul>
                      <div className="cart-flyout-summary">
                        <span>Subtotal</span>
                        <span>{price(subtotalCents)}</span>
                      </div>
                    </>
                  )}
                  <div className="cart-flyout-actions">
                    <Link href="/cart" className="cart-flyout-view">
                      View cart
                    </Link>
                    {cartItems.length > 0 && (
                      <Link href="/checkout" className="buy cart-flyout-checkout">
                        Checkout
                      </Link>
                    )}
                  </div>
                </div>
              </details>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}