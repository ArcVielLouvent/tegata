/**
 * Zod schemas mirroring packages/schema/tegata.schema.json.
 *
 * These are the canonical TypeScript-side data shapes used by apps/web.
 * If you change this file, update tegata.schema.json (and
 * packages/schema/python/models.py) to match.
 */
import { z } from "zod";

export const RiskTier = z.enum(["low", "medium", "high"]);
export type RiskTier = z.infer<typeof RiskTier>;

export const WarrantStatus = z.enum([
  "requested",
  "scored",
  "pending_approval",
  "signed",
  "active",
  "expired",
  "revoked",
  "expired_unapproved",
]);
export type WarrantStatus = z.infer<typeof WarrantStatus>;

export const AccessRequestSchema = z
  .object({
    resource: z.string().min(1),
    reason: z.string().min(1).max(500),
    requested_duration_minutes: z.number().int().min(1).max(1440),
    ticket_ref: z.string().nullable().optional(),
    requested_by: z.string().optional(),
  })
  .strict();
export type AccessRequest = z.infer<typeof AccessRequestSchema>;

export const RiskFactorsSchema = z
  .object({
    resource_sensitivity: z.number().int().default(0),
    duration_factor: z.number().int().default(0),
    time_of_day_factor: z.number().int().default(0),
    requester_history_factor: z.number().int().default(0),
  })
  .strict();

export const RiskScoreSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    tier: RiskTier,
    factors: RiskFactorsSchema,
  })
  .strict();
export type RiskScore = z.infer<typeof RiskScoreSchema>;

export const ApprovalRequirementSchema = z
  .object({
    required_approver_count: z.number().int().min(1).max(2),
    max_duration_minutes: z.number().int().min(1),
  })
  .strict();
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const WarrantSchema = z
  .object({
    warrant_id: z.string(),
    request: AccessRequestSchema,
    risk_score: RiskScoreSchema,
    approval_requirement: ApprovalRequirementSchema,
    status: WarrantStatus,
    used: z.boolean().default(false),
    document_url: z.string().nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
  })
  .strict();
export type Warrant = z.infer<typeof WarrantSchema>;

export const AuditLogEntrySchema = z
  .object({
    entry_id: z.string(),
    warrant_id: z.string(),
    event: z.string(),
    timestamp: z.string().datetime(),
    actor: z.string().nullable().optional(),
    prev_hash: z.string().nullable(),
    hash: z.string(),
  })
  .strict();
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
