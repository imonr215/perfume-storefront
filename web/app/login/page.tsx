import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="wrap">
      <div className="auth-page">
        <h1 className="page-title">Log in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
