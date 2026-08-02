import type { Metadata } from "next";
import { Fraunces, Karla } from "next/font/google";
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
  title: "Maple & Musk — fragrance counter",
  description:
    "A small fragrance counter. Browse the full shelf, find your scent, and reorder the one you already love.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <header className="masthead">
          <div className="wrap masthead-inner">
            <a href="/" className="wordmark">
              Maple <span>&amp;</span> Musk
            </a>
            <p className="masthead-note">Kiosk pickup or delivery</p>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}