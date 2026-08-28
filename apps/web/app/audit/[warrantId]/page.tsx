"use client";

import { useEffect, useState } from "react";
import { getWarrant, getAuditLog, apiMode } from "../../../lib/apiClient";
import type { MockWarrant } from "../../../lib/mockStore";

function short(hash: string | null): string {
  if (!hash) return "(none — first entry)";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export default function AuditTrailPage({ params }: { params: { warrantId: string } }) {
  const { warrantId } = params;
  const [warrant, setWarrant] = useState<MockWarrant | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [chainIntact, setChainIntact] = useState(true);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [{ warrant }, { entries, chain_intact }] = await Promise.all([getWarrant(warrantId), getAuditLog(warrantId)]);
      setWarrant(warrant);
      setEntries(entries);
      setChainIntact(chain_intact);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warrantId]);

  return (
    <>
      <h1>Audit trail</h1>
      <p className="subtitle">
        Mode: <span className="mono">{apiMode()}</span> — every entry stores a SHA-256 hash of its own content plus the
        previous entry's hash. Tampering with any stored row breaks the chain from that point forward.
      </p>

      <p className="mono">{warrantId}</p>

      {loading && <p className="muted">Loading…</p>}

      {!loading && warrant && (
        <div className="row" style={{ marginBottom: "1rem" }}>
          <span className={`badge ${warrant.risk_score.tier}`}>{warrant.risk_score.tier} risk</span>
          <span className="badge status" data-testid="audit-warrant-status">
            {warrant.status}
          </span>
        </div>
      )}

      <div
        className={`banner ${chainIntact ? "success" : "error"}`}
        data-testid="chain-integrity-banner"
      >
        {chainIntact ? "Hash chain intact — every entry links correctly to the one before it." : "Chain integrity broken — a stored entry does not match its recomputed hash."}
      </div>

      <div data-testid="audit-entries">
        {entries.map((entry, i) => (
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
        {entries.length === 0 && !loading && <p className="muted">No audit entries yet for this warrant.</p>}
      </div>
    </>
  );
}
