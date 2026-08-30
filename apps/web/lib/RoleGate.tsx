"use client";

import Link from "next/link";
import { useAuth } from "./AuthContext";
import { apiMode } from "./apiClient";

/**
 * Page-level role gate for the two role-exclusive screens (Requester
 * vs Approver). This is a UX/defense-in-depth layer only — it stops a
 * confusing "wait, why am I looking at someone else's queue?" moment
 * in the UI, it is NOT the real security boundary. The actual
 * authorization has to be enforced server-side (Xano), since anyone
 * who can read this bundle can also see exactly which roles are
 * allowed here and call the API directly, bypassing this component
 * entirely. See docs/xano-setup.md §RBAC.
 *
 * No-op in mock mode: mock mode has no login/role concept at all
 * (AuthStatus.tsx already returns null there), so gating on `role`
 * would just lock everyone out of both pages during local dev.
 */
export function RoleGate({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const { user } = useAuth();

  if (apiMode() !== "xano") return <>{children}</>;

  const role = user?.role || "requester"; // Xano's own default for a new signup
  if (allow.includes(role)) return <>{children}</>;

  const otherScreen = allow.includes("approver") ? { href: "/", label: "Request access" } : { href: "/approver", label: "Approve access" };

  return (
    <div className="banner warning" data-testid="role-denied">
      <strong style={{ display: "block", marginBottom: "0.3rem" }}>This screen isn't for your role.</strong>
      Your account is role <span className="mono">{role}</span>. This page requires{" "}
      {allow.map((r, i) => (
        <span key={r}>
          {i > 0 ? " or " : ""}
          <span className="mono">{r}</span>
        </span>
      ))}
      . <Link href={otherScreen.href}>Go to {otherScreen.label} →</Link>
    </div>
  );
}
