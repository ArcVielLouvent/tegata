"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listWarrants, signWarrant, apiMode, ApiError } from "../../lib/apiClient";
import type { MockWarrant } from "../../lib/mockStore";

export default function ApproverPage() {
  const [warrants, setWarrants] = useState<MockWarrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [signerEmail, setSignerEmail] = useState("approver@example.com");
  const [messages, setMessages] = useState<Record<string, { kind: "success" | "error"; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const { warrants } = await listWarrants();
      setWarrants(warrants);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSign(warrantId: string) {
    setBusy(warrantId);
    try {
      const { warrant } = await signWarrant(warrantId, signerEmail);
      setMessages((m) => ({
        ...m,
        [warrantId]: {
          kind: "success",
          text:
            warrant.status === "active"
              ? `Signed and activated by ${signerEmail}.`
              : `Signature recorded (${warrant.signatures.length}/${warrant.approval_requirement.required_approver_count} collected) — waiting on more approvers.`,
        },
      }));
      await refresh();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : String(err);
      setMessages((m) => ({ ...m, [warrantId]: { kind: "error", text } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>Approve access requests</h1>
      <p className="subtitle">
        Mode: <span className="mono">{apiMode()}</span> — signing a warrant that requires 2 approvers needs this action
        performed twice (by different approvers, in a real flow) before it activates. Signing an already-active warrant
        again demonstrates anti-replay rejection.
      </p>

      <label htmlFor="signerEmail">Signing as</label>
      <input id="signerEmail" type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} data-testid="signer-email-input" />

      <div className="row" style={{ marginTop: "1rem" }}>
        <button type="button" className="secondary" onClick={refresh} disabled={loading} data-testid="refresh-warrants">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {warrants.length === 0 && !loading && <p className="muted">No requests yet — submit one from the Requester view.</p>}

      <div data-testid="warrant-list" style={{ marginTop: "1.25rem" }}>
        {warrants.map((w) => {
          const msg = messages[w.warrant_id];
          const canSign = w.status === "pending_approval" || w.status === "signed";
          return (
            <div className="card" key={w.warrant_id} data-testid={`warrant-card-${w.warrant_id}`}>
              <div className="row">
                <strong className="mono">{w.warrant_id}</strong>
                <span className={`badge ${w.risk_score.tier}`}>{w.risk_score.tier} risk</span>
                <span className="badge status" data-testid={`warrant-status-${w.warrant_id}`}>
                  {w.status}
                </span>
              </div>
              <p className="muted" style={{ marginBottom: "0.4rem" }}>
                {w.request.resource} · {w.request.reason} · requested by {w.request.requested_by || "unknown"}
              </p>
              <p style={{ marginBottom: "0.4rem" }}>
                Signatures: <strong data-testid={`signature-count-${w.warrant_id}`}>{w.signatures.length}</strong> /{" "}
                {w.approval_requirement.required_approver_count} required
                {w.expires_at && w.status === "active" ? ` · expires ${new Date(w.expires_at).toLocaleTimeString()}` : ""}
              </p>

              <div className="row">
                <button type="button" onClick={() => handleSign(w.warrant_id)} disabled={busy === w.warrant_id} data-testid={`sign-${w.warrant_id}`}>
                  {busy === w.warrant_id ? "Signing…" : w.status === "active" ? "Replay attempt (sign again)" : "Sign"}
                </button>
                <Link href={`/audit/${w.warrant_id}`}>View audit trail →</Link>
              </div>

              {msg && (
                <div className={`banner ${msg.kind}`} data-testid={`warrant-message-${w.warrant_id}`} style={{ marginBottom: 0 }}>
                  {msg.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
