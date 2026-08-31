/**
 * TS port of apps/agent/src/tegata_agent/warrant_variables.py — maps a
 * warrant's request + risk score + approval requirement into the
 * TemplateVariable list Doctavian's generate_document expects. Same
 * field names/values as the Python original; keep both in sync.
 */
import type { TemplateVariable } from "./doctavianClient";

export function buildWarrantVariables(w: {
  resource: string;
  requested_by: string;
  reason: string;
  requested_duration_minutes: number;
  risk_score: number;
  risk_tier: string;
  factors: { resource_sensitivity: number; duration_factor: number; time_of_day_factor: number; requester_history_factor: number };
  max_duration_minutes: number;
  required_approver_count: number;
}): TemplateVariable[] {
  return [
    { name: "resource", value: w.resource },
    { name: "requested_by", value: w.requested_by },
    { name: "reason", value: w.reason },
    { name: "requested_duration_minutes", value: String(w.requested_duration_minutes) },
    { name: "max_duration_minutes", value: String(w.max_duration_minutes) },
    { name: "risk_score", value: String(w.risk_score) },
    { name: "risk_tier", value: w.risk_tier },
    { name: "required_approver_count", value: String(w.required_approver_count) },
    { name: "factor_resource_sensitivity", value: String(w.factors.resource_sensitivity) },
    { name: "factor_duration", value: String(w.factors.duration_factor) },
    { name: "factor_time_of_day", value: String(w.factors.time_of_day_factor) },
    { name: "factor_requester_history", value: String(w.factors.requester_history_factor) },
  ];
}
