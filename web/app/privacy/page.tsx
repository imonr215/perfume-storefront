import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Perfumery at The Fashion District",
};

export default function PrivacyPage() {
  return (
    <main className="wrap legal">
      <Link href="/" className="back">
        ← Back to the shelf
      </Link>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated August 2, 2026</p>

      <p>
        This describes what information Perfumery at The Fashion District collects when you
        browse or order through this site, and what we do with it.
      </p>

      <h2>What we collect</h2>
      <p>When you check out, we collect:</p>
      <ul>
        <li>Your name and phone number</li>
        <li>Your email (used for your receipt and, if you create one, your account)</li>
      </ul>
      <p>
        If you create an account, we also store any addresses you choose to
        save, your order history, and your wishlist. We do not collect or
        store your card number. Orders placed
        through this site are paid for by tapping or inserting your card
        directly on the payment terminal at our kiosk, not through this
        website -- your card details never reach our server or your browser
        at all.
      </p>

      <h2>Cookies</h2>
      <p>
        This site uses a small number of functional, first-party cookies:
        one to identify your cart (so it survives between visits before you
        check out) and, if you&apos;re signed in, one to keep you logged in.
        We don&apos;t use advertising or analytics cookies, and we
        don&apos;t sell or rent your information to anyone.
      </p>

      <h2>How we use it</h2>
      <p>
        To fulfill your order: preparing your pickup and sending your
        receipt once payment completes at the kiosk. If you have an
        account, we also use it to show you your order history, saved
        addresses, and wishlist. Clover acts as our payment processor; see{" "}
        <a href="https://www.clover.com/privacy-policy" target="_blank" rel="noreferrer">
          Clover&apos;s own privacy policy
        </a>{" "}
        for how they handle payment data.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Order information is kept as part of our normal business and tax
        records for as long as required by law. Account information is kept
        until you ask us to delete it, except where we&apos;re required to
        keep order records regardless.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask us what information we have about you, or ask us to
        delete your account, by emailing{" "}
        <a href="mailto:imonr215@gmail.com">imonr215@gmail.com</a>. We&apos;ll
        honor that request except where we&apos;re required to keep order
        records for legal or tax reasons.
      </p>

      <h2>Children</h2>
      <p>
        This site isn&apos;t directed at children, and we don&apos;t
        knowingly collect information from anyone under 13.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, we&apos;ll update the &quot;last
        updated&quot; date above.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy:{" "}
        <a href="mailto:imonr215@gmail.com">imonr215@gmail.com</a>.
      </p>
    </main>
  );
}
