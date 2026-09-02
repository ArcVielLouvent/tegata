"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/AuthContext";
import { apiMode } from "../../../lib/apiClient";

type GateResult =
  | { granted: true; warrant_id: string; expires_at: string; content: string }
  | { granted: false; error: string; message: string };

export default function ResourceGatePage() {
  const params = useParams<{ resource: string }>();
  const resource = params.resource;
  const { user, token, loading: authLoading } = useAuth();
  const [result, setResult] = useState<GateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  async function check() {
    if (apiMode() !== "xano" || !token) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/resource/${encodeURIComponent(resource)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await res.json()) as GateResult;
      setResult(body);
      setLastCheckedAt(new Date());
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!authLoading) check();
    // Re-check on an interval so an expiring warrant visibly flips back
    // to denied on its own, without a manual refresh -- this is the part
    // that's supposed to demonstrate real enforcement, not a one-time
    // page load check.
    const id = setInterval(() => {
      if (!authLoading) check();
    }, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, resource]);

  if (apiMode() !== "xano") {
    return (
      <>
        <h1>Protected resource: {resource}</h1>
        <p className="subtitle">
          This gate only makes sense against real Xano — <span className="mono">mock</span> mode has no server-side
          warrant state to check. Switch <span className="mono">NEXT_PUBLIC_API_MODE</span> to <span className="mono">xano</span>.
        </p>
      </>
    );
  }

  if (authLoading) return null;

  if (!token) {
    return (
      <>
        <h1>Protected resource: {resource}</h1>
        <p className="subtitle">
          You need to be logged in for this to check anything real. <Link href="/login">Log in or register</Link> first.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Protected resource: <span className="mono">{resource}</span></h1>
      <p className="subtitle">
        This isn't a UI state — every load (and every 10s after) it asks Xano fresh, with your real token, whether an
        active, unexpired warrant for exactly this resource exists on your account. Nothing here is faked client-side.
      </p>

      {checking && !result && <p className="muted">Checking…</p>}

      {result && !result.granted && (
        <div style={{ border: "1px solid #c0392b", background: "#fdecea", padding: "1rem", borderRadius: 8 }}>
          <strong>🔒 Access denied.</strong>
          <p style={{ marginBottom: 0 }}>{result.message}</p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/">Request access to &quot;{resource}&quot;</Link> — once it's approved and signed, come back
            to this exact URL.
          </p>
        </div>
      )}

      {result && result.granted && (
        <div style={{ border: "1px solid #2e7d32", background: "#eaf7ea", padding: "1rem", borderRadius: 8 }}>
          <strong>✅ Access granted</strong> — warrant <span className="mono">{result.warrant_id}</span>, expires{" "}
          {new Date(result.expires_at).toLocaleString()}.
          <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem" }}>{result.content}</pre>
        </div>
      )}

      <p className="muted" style={{ marginTop: "1rem" }}>
        {lastCheckedAt ? `Last checked ${lastCheckedAt.toLocaleTimeString()}` : ""}{" "}
        <button onClick={check} disabled={checking}>
          Check again now
        </button>
      </p>
    </>
  );
}
