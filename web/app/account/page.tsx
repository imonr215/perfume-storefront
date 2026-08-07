import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();

  return (
    <main className="wrap">
      <div className="account-page">
        <h1 className="page-title">Your account</h1>

        <section className="account-card">
          <p className="section-label">Signed in as</p>
          <p className="detail-blurb account-card-name">{session.name || session.email}</p>
          {session.name && <p className="spec">{session.email}</p>}
        </section>

        <nav className="account-nav">
          <Link href="/account/orders" className="back">
            Order history →
          </Link>
          <Link href="/account/addresses" className="back">
            Saved addresses →
          </Link>
        </nav>

        <form action={logoutAction}>
          <button type="submit" className="cart-remove">
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}
