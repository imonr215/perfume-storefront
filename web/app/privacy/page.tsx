import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Bloom & Basin",
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
        This describes what information Bloom &amp; Basin collects when you
        browse or order through this site, and what we do with it.
      </p>

      <h2>What we collect</h2>
      <p>When you check out, we collect:</p>
      <ul>
        <li>Your name and phone number</li>
        <li>Your email (used for your receipt and, if you create one, your account)</li>
        <li>Your shipping address, if you choose shipping over pickup</li>
      </ul>
      <p>
        If you create an account, we also store your saved addresses, your
        order history, and your wishlist. We do not collect or store your
        card number. Card details are entered directly into a payment form
        provided by Square and are tokenized in your browser before anything
        reaches our server; we only ever see a one-time payment token, never
        the card itself.
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
        To fulfill your order: charging your card via Square, preparing
        your pickup or shipment, and sending your receipt. If you have an
        account, we also use it to show you your order history, saved
        addresses, and wishlist. Square acts as our payment processor for
        this; see{" "}
        <a
          href="https://squareup.com/us/en/legal/general/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Square&apos;s own privacy policy
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
