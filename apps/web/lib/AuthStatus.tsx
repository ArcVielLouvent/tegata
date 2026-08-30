"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthContext";
import { apiMode } from "./apiClient";

function initials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email || "?").slice(0, 2).toUpperCase();
}

export function AuthStatus() {
  const { user, token, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="avatar"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="account-menu-button"
      >
        {initials(user?.name, user?.email)}
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <span className="who-email" data-testid="auth-user-email">
            {user?.email ?? "…"} {user?.role ? `· ${user.role}` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            data-testid="logout-button"
            role="menuitem"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
