# Xano Setup Guide

Xano is a no-code/visual backend — its real logic lives in your Xano dashboard's
**Function Stack** builder, not in a file this repo can generate for you. This
guide tells you exactly what to build there, mirroring the tested reference
implementation in `apps/agent/src/tegata_agent/` so both stay in agreement.

If you ever change the Python reference implementation, update this guide
(and your actual Xano Function Stack) to match — nothing keeps a no-code
visual builder automatically in sync with a code file.

---

## 1. Sign up

1. Go to https://go.xano.co/devpost-challenge
2. Apply coupon code `M_Xano_PER_100_2608_1_DevpostHackathon` at checkout for
   1 free month of the Essential Instance.
3. In your workspace **Settings**, enable **direct workspace pushing** so the
   Xano CLI/MCP can push directly (needed if you want to script parts of this
   instead of clicking through the UI by hand).

## 2. Tables

Create these tables (field names should match `packages/schema/tegata.schema.json`):

### `resource_tiers`
| field | type | notes |
|---|---|---|
| resource | text | unique, e.g. `db_payment_prod` |
| sensitivity | int | see `RESOURCE_SENSITIVITY` in `risk_engine.py` for starting values |

### `requests`
| field | type | notes |
|---|---|---|
| resource | text | must exist in `resource_tiers` — reject otherwise |
| reason | text | |
| requested_duration_minutes | int | 1–1440 |
| ticket_ref | text, nullable | |
| requested_by | text | |
| created_at | timestamp | |

### `warrants`
Mirrors the `Warrant` object in `tegata.schema.json`: `warrant_id` (unique), a
reference to its `requests` row, `risk_score` + `risk_tier` + factor
breakdown fields, `required_approver_count`, `max_duration_minutes`,
`status` (enum matching `WarrantStatus`), `used` (bool, default false),
`document_url`, `expires_at`.

### `audit_log`
`entry_id`, `warrant_id`, `event`, `timestamp`, `actor`, `prev_hash`,
`hash`. (The `prev_hash`/`hash` chain is a Phase 7 stretch feature — create
the fields now, wire up the hashing logic later.)

## 3. Function Stack: `POST /score`

Input: a `requests` row (or its fields directly).

Replicate the logic from `risk_engine.py` step by step as Xano Function
Stack nodes:

1. **Get record** from `resource_tiers` where `resource` matches input.
   If not found, use the default sensitivity value (`30` — see
   `DEFAULT_RESOURCE_SENSITIVITY`).
2. **Math node**: `duration_factor = min(30, round((requested_duration_minutes / 1440) * 30))`
3. **Conditional node**: check the input timestamp's day-of-week and hour.
   - If Saturday/Sunday → add 15
   - If hour < 8 or hour >= 20 → add 15
4. **Query** `warrants` joined to `requests` for this requester, count how
   many had `risk_tier = high` in the last 30 days. Multiply by 5, cap at 15
   (see `HISTORY_PENALTY_PER_PRIOR_HIGH_RISK` / `MAX_HISTORY_FACTOR`).
5. **Sum** all four factors, cap at 100.
6. **Conditional node** for tier: `>= 70` → `high`, `>= 40` → `medium`,
   else → `low`. (See `HIGH_RISK_THRESHOLD` / `MEDIUM_RISK_THRESHOLD`.)
7. **Add record** to `warrants` with status `scored`.

**Test this against the exact cases in `apps/agent/tests/test_risk_engine.py`**
before moving on — same resource, same duration, same timestamp should
produce the same score and tier as the Python reference.

## 4. Function Stack: `POST /derive-approval-requirement`

Replicate `approval_rules.py`:

| tier | required_approver_count | max_duration_minutes (cap) |
|---|---|---|
| high | 2 | 60 |
| medium | 1 | 240 |
| low | 1 | 1440 |

`effective_max_duration_minutes = min(requested_duration_minutes, tier_cap)`.

Test against `apps/agent/tests/test_approval_rules.py`.

## 5. Function Stack: status transitions

Whenever any endpoint changes a warrant's `status`, validate the transition
against this table (mirrors `state_machine.py` — reject with an error if
the requested transition isn't listed):

| from | allowed to |
|---|---|
| requested | scored |
| scored | pending_approval |
| pending_approval | signed, expired_unapproved |
| signed | active |
| active | expired, revoked |
| expired / revoked / expired_unapproved | *(none — terminal)* |

Test against `apps/agent/tests/test_state_machine.py`.

## 6. RBAC

Xano has built-in auth/role support — use it to enforce:
- `requester` role: can create `requests`, can view their own warrants.
- `approver` role: can view pending warrants, can trigger the sign-request
  step (Phase 3), cannot create requests for others.
- `security_admin` role: can view everything, including the audit log.

## 7. Function Stack: `POST /audit-log/append` (Phase 5)

Replicate `audit_log.append_entry()` from
`apps/agent/src/tegata_agent/audit_log.py`:

1. **Get the most recent `audit_log` row** for this `warrant_id` (order by
   `timestamp` descending, limit 1). If none exists, this is the first
   entry — `prev_hash` is `null`.
2. **Build the canonical content string**: a JSON object with keys
   `warrant_id`, `event`, `timestamp` (ISO 8601), `actor` (nullable),
   `prev_hash` (nullable) — **keys must be sorted alphabetically** and
   serialized with no extra whitespace (`,`/`:` separators only), or the
   hash will not match the Python reference implementation. Xano's
   Text/JSON functions can build this manually field-by-field if a
   built-in canonical-JSON function isn't available — do NOT rely on a
   generic "convert object to JSON" function unless you've confirmed it
   sorts keys and omits whitespace identically.
3. **Hash node**: SHA-256 the canonical string (Xano has a built-in
   hashing function under Security/Crypto). This becomes `hash`.
4. **Add record** to `audit_log` with `entry_id` (generate a UUID),
   `warrant_id`, `event`, `timestamp`, `actor`, `prev_hash` (from step 1),
   `hash` (from step 3).

**Test this against the exact cases in `apps/agent/tests/test_audit_log.py`**
— same warrant_id/event/timestamp/actor/prev_hash must produce the exact
same SHA-256 hex digest as the Python reference. If the hashes don't
match, the canonical-JSON serialization step (2) is almost certainly the
culprit (wrong key order, extra whitespace, or a different timestamp
string format).

## 8. Function Stack: scheduled task — auto-expire sweep (Phase 5)

Xano supports scheduled/background tasks. Create one that runs on a
short interval (every 10-15 seconds is fine for the accelerated demo
TTL; every 1-5 minutes is more appropriate for a real deployment) and
replicates `auto_expire.check_and_expire()`:

1. **Query** all `warrants` rows where `status = "active"` and
   `expires_at <= now()`.
2. For each matching row:
   a. **Validate the transition** `active -> expired` against the same
      table used in section 5 (should always be legal here, but route
      through the same validation logic rather than assuming — keeps one
      source of truth).
   b. **Update** the warrant's `status` to `expired`.
   c. **Append an audit_log entry** (see section 7 above) with
      `event = "auto_expired"` and `actor = null` — this is the whole
      point of Phase 5's demo moment: the transition happens with zero
      human action, and the audit trail reflects that (`actor` being
      null is itself meaningful, not an oversight).

**`expires_at` itself** is computed once, when a warrant transitions
`signed -> active` (not by this scheduled task): take the activation
timestamp, add `approval_requirement.max_duration_minutes` — in real
minutes for production, or compressed via `DEMO_TTL_ACCELERATION_SECONDS`
(see `.env.example` and `ttl.compute_expires_at()`) for a fast demo
recording. Store the result in the `warrants.expires_at` field so the
scheduled sweep above only ever needs a plain timestamp comparison, not
a duration calculation on every tick.

**Test the sweep logic against `apps/agent/tests/test_auto_expire.py`**
— in particular the "safe no-op" cases: calling the sweep on a warrant
that's already `expired`, or hasn't reached `active` yet, must never
error and must never attempt an illegal transition, since a real
scheduled task will re-scan every row on every tick regardless of
whether it already handled that row before.

## 9. What's still open

- Anti-replay + signature verification (Phase 3) — depends on the Foxit
  integration, not yet built.
- Live demonstration of hash-chain tamper detection against a real Xano
  table (Phase 7 "Stretch C" — deliberately editing a stored row via the
  Xano dashboard and showing `verify_chain()`-equivalent logic catch it).
  The underlying hashing/chaining logic itself is implemented as of
  Phase 5 (see section 7 above and `audit_log.py`); Stretch C is the
  demo-video moment built on top of it, not new logic.
