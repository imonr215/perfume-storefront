import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Karla } from "next/font/google";
import { getSession } from "@/lib/auth";
import { cartCount } from "@/lib/cart";
import { logoutAction } from "@/lib/actions/auth";
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
  const [session, count] = await Promise.all([getSession(), cartCount()]);

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
              <Link href="/cart" className="site-nav-cart">
                Cart{count > 0 ? ` (${count})` : ""}
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}