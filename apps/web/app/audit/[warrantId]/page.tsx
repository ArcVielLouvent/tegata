"use client";

import { useEffect, useState } from "react";
import { getWarrant, getAuditLog, apiMode } from "../../../lib/apiClient";
import { useAuth } from "../../../lib/AuthContext";
import type { MockWarrant } from "../../../lib/mockStore";

const PAGE_SIZE = 10;

function short(hash: string | null): string {
  if (!hash) return "(none — first entry)";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export default function AuditTrailPage({ params }: { params: { warrantId: string } }) {
  const { warrantId } = params;
  const { loading: authLoading } = useAuth();
  const [warrant, setWarrant] = useState<MockWarrant | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [chainIntact, setChainIntact] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Caps how many chain entries render at once — this list only ever
  // grows for an active warrant, so without a cap it would become an
  // endless page over its lifetime. Original chronological order (and
  // therefore existing audit-entry-{i} indices) is left untouched.
  const [shown, setShown] = useState(PAGE_SIZE);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [{ warrant }, { entries, chain_intact }] = await Promise.all([getWarrant(warrantId), getAuditLog(warrantId)]);
      setWarrant(warrant);
      setEntries(entries);
      setChainIntact(chain_intact);
    } catch (err) {
      // Fixed 2026-09-01: this used to have no catch at all, so ANY
      // failure here -- a real 403 forbidden_owner for a warrant you
      // don't own, or a 401 from firing before the token finished
      // restoring -- was silently swallowed, leaving the page showing
      // its default "chain intact, no entries" state. That looks
      // identical to "this warrant genuinely has no history yet," not
      // "you were denied access" -- actively misleading for exactly
      // the ownership boundary this page exists to demonstrate.
      setWarrant(null);
      setEntries([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Fixed 2026-09-01: was firing immediately on mount, before
    // AuthContext finished restoring the token from localStorage on a
    // fresh page load (getStoredToken() -> fetchMe() is async) --
    // could genuinely 401 for that first render even with a valid
    // token, same race already fixed in RoleGate/AuthContext.
    if (apiMode() === "xano" && authLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warrantId, authLoading]);

  return (
    <>
      <span className="role-chip">every entry here is permanent — nothing can be edited or deleted</span>
      <h1>Audit trail</h1>
      <p className="subtitle">
        Mode: <span className="mono">{apiMode()}</span> — every entry stores a SHA-256 hash of its own content plus the
        previous entry's hash. Tampering with any stored row breaks the chain from that point forward.
      </p>

      <p className="mono">{warrantId}</p>

      {loading && <p className="muted">Loading…</p>}

      {!loading && error && (
        <div className="banner error" data-testid="audit-error-banner">
          Couldn't load this audit trail: {error}
        </div>
      )}

      {!loading && !error && warrant && (
        <div className="row" style={{ marginBottom: "1rem", alignItems: "center" }}>
          <div className={`stamp ${warrant.risk_score.tier}`} style={{ width: 44, height: 44 }}>
            <span className="tier" style={{ fontSize: "0.6rem" }}>
              {warrant.risk_score.tier}
            </span>
          </div>
          <span className="badge status" data-testid="audit-warrant-status">
            {warrant.status}
          </span>
        </div>
      )}

      {!loading && !error && (
        <div className={`banner ${chainIntact ? "success" : "error"}`} data-testid="chain-integrity-banner">
          {chainIntact
            ? "Hash chain intact — every entry links correctly to the one before it."
            : "Chain integrity broken — a stored entry does not match its recomputed hash."}
        </div>
      )}

      {!loading && !error && (
        <div data-testid="audit-entries">
          {entries.slice(0, shown).map((entry, i) => (
            <div className="chain-entry" key={entry.entry_id} data-testid={`audit-entry-${i}`}>
              <div className="row">
                <strong>{entry.event}</strong>
                <span className="muted">{entry.timestamp}</span>
                {entry.actor && <span className="muted">by {entry.actor}</span>}
              </div>
              <div className="mono muted">prev_hash: {short(entry.prev_hash)}</div>
              <div className="mono muted">hash: {short(entry.hash)}</div>
            </div>
          ))}
          {entries.length === 0 && <p className="muted">No audit entries yet for this warrant.</p>}
          {shown < entries.length && (
            <button type="button" className="view-more" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              View more entries ({entries.length - shown} remaining) →
            </button>
          )}
        </div>
      )}
    </>
  );
}

