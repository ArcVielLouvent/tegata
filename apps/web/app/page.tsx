"use client";

import { useState } from "react";
import Link from "next/link";
import { createWarrant, apiMode, ApiError } from "../lib/apiClient";
import { useAuth } from "../lib/AuthContext";
import type { MockWarrant } from "../lib/mockStore";

const RESOURCES = [
  "db_payment_prod",
  "db_payment_staging",
  "db_analytics_prod",
  "server_web_prod",
  "server_web_staging",
  "internal_wiki",
];

export default function RequesterPage() {
  const { user, token, loading: authLoading } = useAuth();
  const [resource, setResource] = useState(RESOURCES[0]);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(60);
  const [ticketRef, setTicketRef] = useState("");
  const [requestedBy, setRequestedBy] = useState("requester@example.com");
  const [warrant, setWarrant] = useState<MockWarrant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Phase 4 AI front-door: free text -> LLM two-pass extraction -> hard
  // validation gate (server-side, see app/api/nlu/parse/route.ts) ->
  // fills the form below for the human to review and actually submit.
  // The AI proposes; it never submits on the user's behalf — that's
  // still a manual "Submit request" click, same principle as
  // nlu_frontdoor.py's own docstring.
  const [nlText, setNlText] = useState("");
  const [nlBusy, setNlBusy] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlConcerns, setNlConcerns] = useState<string | null>(null);

  async function handleParse() {
    if (!nlText.trim()) return;
    setNlBusy(true);
    setNlError(null);
    setNlConcerns(null);
    try {
      const res = await fetch("/api/nlu/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nlText }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNlError(body.message || body.error || `HTTP ${res.status}`);
        return;
      }
      const c = body.candidate;
      if (RESOURCES.includes(c.resource)) setResource(c.resource);
      setReason(c.reason ?? "");
      if (typeof c.requested_duration_minutes === "number") setDuration(c.requested_duration_minutes);
      if (c.ticket_ref) setTicketRef(c.ticket_ref);
      if (c.requested_by && apiMode() !== "xano") setRequestedBy(c.requested_by);
      setNlConcerns(body.concerns);
    } catch (err) {
      setNlError(String(err));
    } finally {
      setNlBusy(false);
    }
  }

  const needsLogin = apiMode() === "xano" && !authLoading && !token;

  if (needsLogin) {
    return (
      <>
        <h1>Request privileged access</h1>
        <p className="subtitle">
          Tegata Core requires a logged-in user (xano mode). <Link href="/login">Log in or register</Link> first.
        </p>
      </>
    );
  }

  const effectiveRequestedBy = apiMode() === "xano" ? user?.email || requestedBy : requestedBy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { warrant } = await createWarrant({
        resource,
        reason,
        requested_duration_minutes: Number(duration),
        ticket_ref: ticketRef || undefined,
        requested_by: effectiveRequestedBy || undefined,
      });
      setWarrant(warrant);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Request privileged access</h1>
      <p className="subtitle">
        Mode: <span className="mono">{apiMode()}</span> — the request is scored the instant you submit it; the
        risk tier decides how many approvers are required and how long the access can last.
      </p>

      <div className="nlu-frontdoor">
        <label htmlFor="nlText">Describe what you need (optional — AI front-door)</label>
        <textarea
          id="nlText"
          value={nlText}
          onChange={(e) => setNlText(e.target.value)}
          placeholder="e.g. I need read access to db_analytics_prod for about an hour to investigate a customer-reported billing discrepancy, ticket JIRA-4821"
          data-testid="nl-text-input"
        />
        <button type="button" onClick={handleParse} disabled={nlBusy || !nlText.trim()} data-testid="nl-parse-button">
          {nlBusy ? "Parsing…" : "Fill form from description"}
        </button>
        <p className="muted">
          This only proposes values into the form below — nothing is submitted until you review it and click "Submit request" yourself.
        </p>
        {nlError && (
          <div className="banner error" data-testid="nl-error">
            {nlError}
          </div>
        )}
        {nlConcerns && (
          <div className="banner warning" data-testid="nl-concerns">
            AI flagged a concern while reviewing its own extraction: {nlConcerns}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} data-testid="request-form">
        <label htmlFor="resource">Resource</label>
        <select id="resource" value={resource} onChange={(e) => setResource(e.target.value)} data-testid="resource-select">
          {RESOURCES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label htmlFor="reason">Reason</label>
        <textarea
          id="reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. investigating a customer-reported billing discrepancy"
          data-testid="reason-input"
        />

        <label htmlFor="duration">Requested duration (minutes)</label>
        <input
          id="duration"
          type="number"
          min={1}
          max={1440}
          required
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          data-testid="duration-input"
        />

        <label htmlFor="ticketRef">Ticket reference (optional)</label>
        <input
          id="ticketRef"
          type="text"
          value={ticketRef}
          onChange={(e) => setTicketRef(e.target.value)}
          placeholder="e.g. JIRA-1234"
          data-testid="ticket-ref-input"
        />

        {apiMode() === "xano" ? (
          <>
            <label>Your email</label>
            <p className="muted" style={{ marginTop: 0 }}>
              {effectiveRequestedBy} (from your logged-in session — Xano ignores any value sent here and uses
              $authenticated_user.email instead, see docs/xano-setup.md §9a)
            </p>
          </>
        ) : (
          <>
            <label htmlFor="requestedBy">Your email</label>
            <input id="requestedBy" type="email" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} data-testid="requested-by-input" />
          </>
        )}

        <button type="submit" disabled={submitting} data-testid="submit-request">
          {submitting ? "Scoring…" : "Submit request"}
        </button>
      </form>

      {error && (
        <div className="banner error" data-testid="request-error">
          {error}
        </div>
      )}

      {warrant && (
        <div className="card" data-testid="warrant-result" style={{ marginTop: "1.5rem" }}>
          <div className="row">
            <strong className="mono">{warrant.warrant_id}</strong>
            <span className={`badge ${warrant.risk_score.tier}`} data-testid="risk-tier-badge">
              {warrant.risk_score.tier} risk — score {warrant.risk_score.score}
            </span>
            <span className="badge status">{warrant.status}</span>
          </div>
          <p style={{ marginBottom: 0 }}>
            Requires <strong data-testid="required-approver-count">{warrant.approval_requirement.required_approver_count}</strong> approver
            {warrant.approval_requirement.required_approver_count > 1 ? "s" : ""}, capped at{" "}
            <strong>{warrant.approval_requirement.max_duration_minutes} min</strong>
            {warrant.approval_requirement.duration_was_capped ? " (capped down from what you requested)" : ""}.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            resource_sensitivity {warrant.risk_score.factors.resource_sensitivity} · duration_factor{" "}
            {warrant.risk_score.factors.duration_factor} · time_of_day_factor {warrant.risk_score.factors.time_of_day_factor} ·
            requester_history_factor {warrant.risk_score.factors.requester_history_factor}
          </p>
          <p style={{ marginTop: "0.75rem" }}>
            <Link href="/approver">Go to Approver view →</Link> ·{" "}
            <Link href={`/audit/${warrant.warrant_id}`}>View audit trail →</Link>
          </p>
        </div>
      )}
    </>
  );
}
