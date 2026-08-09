import Link from "next/link";

export const metadata = {
  title: "Refund Policy | Bloom & Basin",
};

export default function RefundsPage() {
  return (
    <main className="wrap legal">
      <Link href="/" className="back">
        ← Back to the shelf
      </Link>
      <h1>Refund Policy</h1>
      <p className="legal-updated">Last updated August 2, 2026</p>

      <h2>All sales are final</h2>
      <p>
        Because of the nature of fragrance products, we don&apos;t accept
        returns or exchanges for a change of mind, wrong choice of scent, or
        similar reasons, opened or not.
      </p>

      <h2>Except when we get it wrong</h2>
      <p>
        If what arrives is damaged, defective, or not what you ordered,
        we&apos;ll make it right: a replacement or a full refund, your
        choice.
      </p>
      <p>
        Email <a href="mailto:imonr215@gmail.com">imonr215@gmail.com</a>{" "}
        within 7 days of delivery or pickup with:
      </p>
      <ul>
        <li>Your order number</li>
        <li>A photo of the item (and the damage, if applicable)</li>
        <li>What&apos;s wrong</li>
      </ul>
      <p>
        If it&apos;s our mistake, we cover any return shipping and issue the
        refund to your original payment method through Square once we&apos;ve
        confirmed the issue.
      </p>

      <h2>Questions</h2>
      <p>
        Reach us at <a href="mailto:imonr215@gmail.com">imonr215@gmail.com</a>{" "}
        before ordering if you&apos;re unsure about a scent. Happy to help
        you pick. See also our <Link href="/terms">Terms of Service</Link>{" "}
        and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </main>
  );
}
