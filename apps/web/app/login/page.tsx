"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { apiMode } from "../../lib/apiClient";

export default function LoginPage() {
  const { login, register, error: authError } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      router.push("/");
    } catch (err: any) {
      setLocalError(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (apiMode() === "mock") {
    return (
      <>
        <h1>Login not needed</h1>
        <p className="subtitle">
          The app is running in <span className="mono">mock</span> mode — the local demo backend has no
          authentication of its own. Set <span className="mono">NEXT_PUBLIC_API_MODE=xano</span> to use a real
          Xano workspace, which does require logging in.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{mode === "login" ? "Log in" : "Register"}</h1>
      <p className="subtitle">
        Tegata Core is a private API group — every request needs a bearer token from a logged-in user. New accounts
        default to the <span className="mono">requester</span> role; an <span className="mono">approver</span>{" "}
        account has to be assigned manually in the Xano dashboard.
      </p>

      <form onSubmit={handleSubmit} data-testid="auth-form">
        {mode === "register" && (
          <>
            <label htmlFor="name">Name</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="name-input" />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email-input" />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password-input" />

        <button type="submit" disabled={submitting} data-testid="auth-submit">
          {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      {(localError || authError) && (
        <div className="banner error" data-testid="auth-error">
          {localError || authError}
        </div>
      )}

      <p style={{ marginTop: "1rem" }}>
        <button type="button" className="secondary" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
        </button>
      </p>
    </>
  );
}
