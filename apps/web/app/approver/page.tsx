"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listWarrants, signWarrant, prepareSignature, attachEnvelope, confirmSignature, apiMode, ApiError } from "../../lib/apiClient";
import { useAuth } from "../../lib/AuthContext";
import type { MockWarrant } from "../../lib/mockStore";

interface PreparedEnvelope {
  folder_id: string | number | null;
  signing_url: string | null;
  document_hash: string;
}

export default function ApproverPage() {
  const { user, token, loading: authLoading } = useAuth();
  const [warrants, setWarrants] = useState<MockWarrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [signerEmail, setSignerEmail] = useState("approver@example.com");
  const [messages, setMessages] = useState<Record<string, { kind: "success" | "error"; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Record<string, PreparedEnvelope>>({});

  const needsLogin = apiMode() === "xano" && !authLoading && !token;
  const effectiveSignerEmail = apiMode() === "xano" ? user?.email || signerEmail : signerEmail;

  const [listError, setListError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      const { warrants } = await listWarrants();
      setWarrants(warrants);
    } catch (err) {
      // Was previously unhandled here (listWarrants() used to silently
      // return [] on an unrecognized response shape, so there was
      // nothing to catch) — now that it throws a diagnostic ApiError
      // instead, this needs to actually surface it, or a real listing
      // failure looks identical to "no requests yet" again, just moved
      // one level up instead of fixed.
      setListError(err instanceof ApiError ? err.message : String(err));
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
      const { warrant } = await signWarrant(warrantId, effectiveSignerEmail);
      setMessages((m) => ({
        ...m,
        [warrantId]: {
          kind: "success",
          text:
            warrant.status === "active"
              ? `Signed and activated by ${effectiveSignerEmail}.`
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

  /** Real pipeline step 1: generate the document (Doctavian) and create
   * a Foxit signing envelope for it. Only offered for
   * required_approver_count === 1 (see prepareSignature's docs). */
  async function handlePrepare(w: MockWarrant) {
    setBusy(w.warrant_id);
    try {
      const result = await prepareSignature(w, { name: user?.name || effectiveSignerEmail, email: effectiveSignerEmail });
      // Tell Xano about the real envelope right away — confirmSignature()
      // has nothing to verify against otherwise (docs/xano-setup.md §13b).
      await attachEnvelope(w.warrant_id, result);
      setPrepared((p) => ({ ...p, [w.warrant_id]: { folder_id: result.folder_id, signing_url: result.signing_url, document_hash: result.document_hash } }));
      setMessages((m) => ({
        ...m,
        [w.warrant_id]: {
          kind: "success",
          text: result.signing_url
            ? "Document generated and sent to Foxit — open the signing link, sign there, then come back and confirm."
            : "Document generated and envelope created, but no signing_url was found in Foxit's response (see raw_envelope in the network tab) — check your email for the signing invite instead.",
        },
      }));
    } catch (err) {
      const text = err instanceof ApiError ? err.message : String(err);
      setMessages((m) => ({ ...m, [w.warrant_id]: { kind: "error", text } }));
    } finally {
      setBusy(null);
    }
  }

  /** Real pipeline step 2: after actually signing at Foxit's
   * signing_url, ask Xano to verify the real envelope status
   * server-to-server and transition the warrant. Requires
   * docs/xano-setup.md §13's endpoint to exist yet. */
  async function handleConfirm(warrantId: string) {
    const envelope = prepared[warrantId];
    if (!envelope?.folder_id) return;
    setBusy(warrantId);
    try {
      const { warrant } = await confirmSignature(warrantId, envelope.folder_id);
      setMessages((m) => ({
        ...m,
        [warrantId]: {
          kind: "success",
          text: warrant.status === "active" ? "Confirmed with Foxit — warrant is active." : `Xano reports status: ${warrant.status}. Have you actually finished signing at the Foxit link yet?`,
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

  if (needsLogin) {
    return (
      <>
        <h1>Approve access requests</h1>
        <p className="subtitle">
          Tegata Core requires a logged-in user (xano mode). <Link href="/login">Log in or register</Link> first —
          note only accounts with role <span className="mono">approver</span> or{" "}
          <span className="mono">security_admin</span> (set manually in the Xano dashboard) can actually sign.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Approve access requests</h1>
      <p className="subtitle">
        Mode: <span className="mono">{apiMode()}</span> — signing a warrant that requires 2 approvers needs this action
        performed twice (by different approvers, in a real flow) before it activates. Signing an already-active warrant
        again demonstrates anti-replay rejection.
      </p>

      {apiMode() === "xano" ? (
        <>
          <label>Signing as</label>
          <p className="muted" style={{ marginTop: 0 }}>
            {effectiveSignerEmail} (from your logged-in session)
          </p>
        </>
      ) : (
        <>
          <label htmlFor="signerEmail">Signing as</label>
          <input id="signerEmail" type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} data-testid="signer-email-input" />
        </>
      )}

      <div className="row" style={{ marginTop: "1rem" }}>
        <button type="button" className="secondary" onClick={refresh} disabled={loading} data-testid="refresh-warrants">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {listError && (
        <div className="banner error" data-testid="list-error">
          {listError}
        </div>
      )}

      {warrants.length === 0 && !loading && !listError && <p className="muted">No requests yet — submit one from the Requester view.</p>}

      <div data-testid="warrant-list" style={{ marginTop: "1.25rem" }}>
        {warrants.map((w) => {
          const msg = messages[w.warrant_id];
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
                {apiMode() === "xano" && w.status === "pending_approval" && w.approval_requirement.required_approver_count === 1 ? (
                  prepared[w.warrant_id]?.folder_id ? (
                    <div className="signing-panel">
                      {/* UNVERIFIED: assumes Foxit's embedded-signing URL
                          actually allows framing (createEmbeddedSigningSession
                          exists specifically for this, but the real
                          X-Frame-Options/CSP behavior hasn't been confirmed
                          from this sandbox). If the iframe below shows blank
                          or a browser console framing error, that's the first
                          thing to check — the fallback is opening
                          prepared[w.warrant_id].signing_url in a new tab
                          instead of an <iframe>. */}
                      {prepared[w.warrant_id].signing_url ? (
                        <>
                          {/* True inline embed ("web in web"), not a new-tab
                              link — this is what createEmbeddedSigningSession
                              in the Foxit call is actually for. Falls back to
                              the "check your email" message below if Foxit's
                              response had no signing_url (extractSigningUrl()
                              in foxitClient.ts couldn't find one). */}
                          <iframe
                            src={prepared[w.warrant_id].signing_url!}
                            data-testid={`embed-${w.warrant_id}`}
                            style={{ width: "100%", height: 600, border: "1px solid #ccc" }}
                            title={`Foxit signing session for ${w.warrant_id}`}
                          />
                        </>
                      ) : (
                        <p>No embedded signing_url in Foxit's response — check your email for the signing invite instead.</p>
                      )}
                      <button type="button" onClick={() => handleConfirm(w.warrant_id)} disabled={busy === w.warrant_id} data-testid={`confirm-${w.warrant_id}`}>
                        {busy === w.warrant_id ? "Confirming…" : "I've signed — confirm"}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => handlePrepare(w)} disabled={busy === w.warrant_id} data-testid={`prepare-${w.warrant_id}`}>
                      {busy === w.warrant_id ? "Generating document…" : "Prepare & send for e-signature"}
                    </button>
                  )
                ) : (
                  <button type="button" onClick={() => handleSign(w.warrant_id)} disabled={busy === w.warrant_id} data-testid={`sign-${w.warrant_id}`}>
                    {busy === w.warrant_id ? "Signing…" : w.status === "active" ? "Replay attempt (sign again)" : "Sign"}
                  </button>
                )}
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
