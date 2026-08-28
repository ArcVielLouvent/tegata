"use client";

import Link from "next/link";
import { useAuth } from "./AuthContext";
import { apiMode } from "./apiClient";

export function AuthStatus() {
  const { user, token, loading, logout } = useAuth();

  if (apiMode() === "mock") return null; // no auth concept in mock mode

  if (loading) return <span className="muted">…</span>;

  if (!token) {
    return (
      <Link href="/login" data-testid="login-link">
        Log in
      </Link>
    );
  }

  return (
    <span className="row" style={{ marginLeft: "1.25rem" }}>
      <span className="muted" data-testid="auth-user-email">
        {user?.email ?? "…"} {user?.role ? `(${user.role})` : ""}
      </span>
      <button type="button" className="secondary" onClick={logout} style={{ marginTop: 0, padding: "0.3rem 0.7rem" }} data-testid="logout-button">
        Log out
      </button>
    </span>
  );
}
