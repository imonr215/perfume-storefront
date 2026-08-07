import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <main className="wrap">
      <div className="auth-page">
        <h1 className="page-title">Create an account</h1>
        <SignupForm />
      </div>
    </main>
  );
}
