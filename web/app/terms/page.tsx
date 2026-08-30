import Link from "next/link";

export const metadata = {
  title: "Terms of Service | Perfumery at The Fashion District",
};

export default function TermsPage() {
  return (
    <main className="wrap legal">
      <Link href="/" className="back">
        ← Back to the shelf
      </Link>
      <h1>Terms of Service</h1>
      <p className="legal-updated">Last updated August 2, 2026</p>

      <p>
        These terms cover your use of the Perfumery at The Fashion District website and any
        order you place through it. By placing an order, you&apos;re agreeing
        to them.
      </p>

      <h2>Who we are</h2>
      <p>
        Perfumery at The Fashion District (&quot;we,&quot; &quot;us&quot;) is a fragrance
        counter operating a physical kiosk as well as this website, operated
        by Jewels &amp; Treasures. Mailing address: 901 Market St,
        Philadelphia, PA 19107.
      </p>

      <h2>Accounts</h2>
      <p>
        No account is required to order; guest checkout is available. If
        you do create one, you&apos;re responsible for keeping your password
        confidential and for anything done through your account. You can
        save addresses, view past orders, and keep a wishlist once signed
        in.
      </p>

      <h2>Orders</h2>
      <p>
        Placing an order is an offer to buy; we confirm it by charging your
        card. Prices, descriptions, and availability can change without
        notice, and we may cancel and refund an order if an item turns out
        to be unavailable or if there&apos;s a pricing error.
      </p>

      <h2>Payment</h2>
      <p>
        Card payments are processed by Clover, tapped or inserted directly on
        the terminal at our kiosk. We never see or store your full card
        number; Clover handles that entirely. See our{" "}
        <Link href="/privacy">Privacy Policy</Link> for details on what
        information we do collect.
      </p>

      <h2>Pickup</h2>
      <p>
        Orders placed through this site are for pickup at our kiosk only, and
        payment is completed there when you arrive. See our{" "}
        <Link href="/refunds">Refund Policy</Link> for what happens if
        something turns out damaged or wrong.
      </p>

      <h2>Site content</h2>
      <p>
        Text, images, and design on this site belong to Perfumery at The Fashion District
        unless otherwise noted, and are here for you to shop with, not to
        copy or republish.
      </p>

      <h2>No warranty; limitation of liability</h2>
      <p>
        We sell fragrance products as-is. To the extent allowed by law, we
        aren&apos;t liable for indirect or consequential damages arising from
        your use of the site or a product you bought through it. Nothing
        here limits liability where the law doesn&apos;t allow it to be
        limited.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of the Commonwealth of Pennsylvania.</p>

      <h2>Changes</h2>
      <p>
        We may update these terms occasionally. The &quot;last updated&quot;
        date above will change when we do.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href="mailto:imonr215@gmail.com">imonr215@gmail.com</a>.
      </p>
    </main>
  );
}
