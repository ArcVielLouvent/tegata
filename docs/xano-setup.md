# Xano Setup Guide

Xano is a no-code/visual backend — its real logic lives in your Xano
dashboard's **Function Stack** builder, not in a file this repo can
generate or push for you. This guide is the checklist for building it
by hand, in the order that actually unblocks the next step, mirroring
the tested reference implementation in `apps/agent/src/tegata_agent/`
so both stay in agreement.

**How to use this guide:** work top to bottom, ticking boxes as you go.
Each Function Stack section names the exact pytest file to check your
Xano logic against — feed the same inputs used in that test file into
your Xano endpoint (via the built-in "Run & Debug" panel or a Postman
call) and confirm the output matches. If it doesn't, the Python
reference is the source of truth; fix the Xano side, not the test.

If you ever change the Python reference implementation, update this
guide (and your actual Xano Function Stack) to match — nothing keeps a
no-code visual builder automatically in sync with a code file.

**Quick reference — endpoint → what to test it against:**

| Endpoint / task | Reference module | Test file |
|---|---|---|
| `POST /score` | `risk_engine.py` | `test_risk_engine.py` |
| `POST /derive-approval-requirement` | `approval_rules.py` | `test_approval_rules.py` |
| Status transition guard | `state_machine.py` | `test_state_machine.py` |
| `POST /audit-log/append` | `audit_log.py` | `test_audit_log.py` |
| Scheduled auto-expire sweep | `auto_expire.py` + `ttl.py` | `test_auto_expire.py`, `test_ttl.py` |
| Signature verification + anti-replay | *(none yet — see §9)* | *(none yet — see §9)* |

---

## 0. Prerequisites

- [ ] Sign up at https://go.xano.co/devpost-challenge
- [ ] Apply coupon code `M_Xano_PER_100_2608_1_DevpostHackathon` at
      checkout for 1 free month of the Essential Instance
- [ ] In workspace **Settings**, enable **direct workspace pushing**
      (only needed if you later want to script parts of this instead of
      clicking through the UI by hand — safe to enable now regardless)
- [ ] Confirm you can open the **Function Stack** builder for a blank
      endpoint before going further — if something's broken here, no
      point building on top of it

## 1. Tables (build these first — everything else references them)

Field names should match `packages/schema/tegata.schema.json`.

### `resource_tiers`
- [ ] `resource` — text, unique — e.g. `db_payment_prod`
- [ ] `sensitivity` — int — see `RESOURCE_SENSITIVITY` in `risk_engine.py`
      for starting values (six rows to seed: `db_payment_prod`=50,
      `db_payment_staging`=20, `db_analytics_prod`=35,
      `server_web_prod`=40, `server_web_staging`=15, `internal_wiki`=5)

### `requests`
- [ ] `resource` — text — must exist in `resource_tiers`, reject otherwise
- [ ] `reason` — text
- [ ] `requested_duration_minutes` — int (1–1440)
- [ ] `ticket_ref` — text, nullable
- [ ] `requested_by` — text
- [ ] `created_at` — timestamp

### `warrants`
Mirrors the `Warrant` object in `tegata.schema.json`:
- [ ] `warrant_id` — text, unique — anti-replay key
- [ ] reference to its `requests` row
- [ ] `risk_score` — int
- [ ] `risk_tier` — enum/text (`low`/`medium`/`high`)
- [ ] factor breakdown fields (`factor_resource_sensitivity`,
      `factor_duration`, `factor_time_of_day`, `factor_requester_history`)
- [ ] `required_approver_count` — int
- [ ] `max_duration_minutes` — int
- [ ] `status` — enum matching `WarrantStatus`
      (`requested`/`scored`/`pending_approval`/`signed`/`active`/
      `expired`/`revoked`/`expired_unapproved`)
- [ ] `used` — bool, default `false` (anti-replay flag, see §9)
- [ ] `document_url` — text, nullable
- [ ] `expires_at` — timestamp, nullable

### `audit_log`
- [ ] `entry_id` — text, unique
- [ ] `warrant_id` — text
- [ ] `event` — text
- [ ] `timestamp` — timestamp
- [ ] `actor` — text, nullable
- [ ] `prev_hash` — text, nullable (null only for a warrant's first entry)
- [ ] `hash` — text

**Checkpoint:** all four tables exist with the fields above before
moving to §2.

## 2. Function Stack: `POST /score`

Input: a `requests` row (or its fields directly).

- [ ] **Get record** from `resource_tiers` where `resource` matches
      input. If not found, use the default sensitivity value (`30` —
      see `DEFAULT_RESOURCE_SENSITIVITY`)
- [ ] **Math node**: `duration_factor = min(30, round((requested_duration_minutes / 1440) * 30))`
- [ ] **Conditional node**: check the input timestamp's day-of-week and hour
      - Saturday/Sunday → add 15
      - hour < 8 or hour >= 20 → add 15
- [ ] **Query** `warrants` joined to `requests` for this requester, count
      how many had `risk_tier = high` in the last 30 days. Multiply by
      5, cap at 15 (see `HISTORY_PENALTY_PER_PRIOR_HIGH_RISK` /
      `MAX_HISTORY_FACTOR`)
- [ ] **Sum** all four factors, cap at 100
- [ ] **Conditional node** for tier: `>= 70` → `high`, `>= 40` →
      `medium`, else → `low` (see `HIGH_RISK_THRESHOLD` /
      `MEDIUM_RISK_THRESHOLD`)
- [ ] **Add record** to `warrants` with status `scored`

**Verify against `test_risk_engine.py`:** same resource + duration +
timestamp must produce the same score and tier as the Python reference.
At minimum, replay `test_compute_risk_score_high_risk_scenario` and
`test_compute_risk_score_low_risk_scenario` by hand.

## 3. Function Stack: `POST /derive-approval-requirement`

| tier | required_approver_count | max_duration_minutes (cap) |
|---|---|---|
| high | 2 | 60 |
| medium | 1 | 240 |
| low | 1 | 1440 |

- [ ] `effective_max_duration_minutes = min(requested_duration_minutes, tier_cap)`
- [ ] Update the `warrants` row with `required_approver_count` and
      `max_duration_minutes`

**Verify against `test_approval_rules.py`** — in particular the capping
cases (`test_high_risk_requires_two_approvers_and_caps_duration`) and
the non-extension case (`test_high_risk_does_not_extend_a_short_request`).

## 4. Function Stack: status transition guard

Whenever any endpoint changes a warrant's `status`, validate against
this table first (mirrors `state_machine.py` — reject with an error if
the requested transition isn't listed):

| from | allowed to |
|---|---|
| requested | scored |
| scored | pending_approval |
| pending_approval | signed, expired_unapproved |
| signed | active |
| active | expired, revoked |
| expired / revoked / expired_unapproved | *(none — terminal)* |

- [ ] Build this as a reusable Function Stack "function" (Xano supports
      custom functions callable from multiple endpoints) so every status
      change — scoring, signing, activation, expiry, revocation — routes
      through the same check instead of duplicating the table

**Verify against `test_state_machine.py`** — especially the invalid-
transition cases (skipping a step, reviving a terminal state).

## 5. RBAC

Xano has built-in auth/role support — use it to enforce:
- [ ] `requester` role: can create `requests`, can view their own warrants
- [ ] `approver` role: can view pending warrants, can trigger the
      sign-request step, cannot create requests for others
- [ ] `security_admin` role: can view everything, including the audit log

## 6. Function Stack: `POST /audit-log/append`

Replicate `audit_log.append_entry()` from
`apps/agent/src/tegata_agent/audit_log.py`:

- [ ] **Get the most recent `audit_log` row** for this `warrant_id`
      (order by `timestamp` descending, limit 1). If none exists, this
      is the first entry — `prev_hash` is `null`
- [ ] **Build the canonical content string**: a JSON object with keys
      `warrant_id`, `event`, `timestamp`, `actor` (nullable), `prev_hash`
      (nullable) — **keys must be sorted alphabetically** and serialized
      with no extra whitespace (`,`/`:` separators only), or the hash
      will not match the Python reference. Build this manually
      field-by-field if Xano's generic "convert object to JSON"
      function doesn't guarantee sorted keys + no whitespace — don't
      assume, confirm
      - [ ] **Timestamp format is load-bearing — get this exact:**
        `YYYY-MM-DDTHH:MM:SSZ` (whole-second precision, literal `Z`
        suffix, e.g. `2026-08-25T10:00:00Z`). The Python reference
        (`audit_log._canonical_timestamp()`) deliberately does NOT use
        a raw `isoformat()` call, because that produces `+00:00`
        instead of `Z` and may include microseconds — either difference
        silently breaks every hash comparison even though both sides
        are internally "correct." Format Xano's timestamp to this exact
        pattern before hashing, not whatever your date-format node
        defaults to
- [ ] **Hash node**: SHA-256 the canonical string (Security/Crypto
      category). This becomes `hash`
- [ ] **Add record** to `audit_log` with `entry_id` (generate a UUID),
      `warrant_id`, `event`, `timestamp`, `actor`, `prev_hash` (from
      step 1), `hash` (from step 3)
- [ ] Call this function from every other endpoint that changes state
      (score, approve, sign, activate, expire, revoke) so nothing
      mutates a warrant without leaving a trail

**Verify against `test_audit_log.py`** — same
warrant_id/event/timestamp/actor/prev_hash must produce the *exact*
same SHA-256 hex digest as the Python reference
(`test_same_content_produces_same_hash_deterministically` is the
fastest way to confirm this). If hashes don't match, the canonical-JSON
step above is almost always the culprit — wrong key order, extra
whitespace, or a different timestamp string format.

## 7. Function Stack: scheduled task — auto-expire sweep

- [ ] Create a Xano scheduled/background task on a short interval
      (10-15s is fine for the accelerated demo TTL; 1-5 min is more
      realistic for production)
- [ ] **Query** all `warrants` rows where `status = "active"` and
      `expires_at <= now()`
- [ ] For each matching row:
  - [ ] **Validate** `active -> expired` through the §4 transition guard
        (should always be legal here, but route through it anyway —
        single source of truth, not a second copy of the rule)
  - [ ] **Update** the warrant's `status` to `expired`
  - [ ] **Append an audit_log entry** (§6) with `event = "auto_expired"`
        and `actor = null` — the null actor is the whole point of this
        phase's demo moment: zero human action, and the trail proves it

`expires_at` itself is computed once, when a warrant transitions
`signed -> active` (not by this scheduled task): activation timestamp +
`approval_requirement.max_duration_minutes`, in real minutes for
production or compressed via `DEMO_TTL_ACCELERATION_SECONDS` (see
`.env.example`, `ttl.compute_expires_at()`) for a fast demo recording.
Store the result on `warrants.expires_at` so the sweep only ever needs a
plain timestamp comparison.

**Verify against `test_auto_expire.py`** — especially the "safe no-op"
cases (`test_non_active_status_never_expires_even_if_time_passed`,
`test_repeated_calls_after_expiry_stay_safe_no_ops`): the sweep will
re-scan every row on every tick regardless of whether it already
handled that row, so it must never error and never attempt an illegal
transition on an already-terminal or not-yet-active warrant.

You can also point `scripts/verify_auto_expire_demo.py` at this same
scenario locally (no Xano needed) to see the expected real-time
behavior before comparing it against your actual scheduled task.

## 8. End-to-end checklist

Once §1–7 are built, walk one warrant through the whole state machine
by hand (Postman or Xano's "Run & Debug") and confirm each step:

- [ ] Create a `requests` row → `POST /score` → status `scored`, score
      + tier populated
- [ ] `POST /derive-approval-requirement` → `required_approver_count` +
      `max_duration_minutes` populated, status still `scored`
- [ ] Manually transition to `pending_approval` → audit entry logged
- [ ] Manually transition to `signed` → audit entry logged (this is
      where Foxit's real callback will eventually plug in — see §9)
- [ ] Manually transition `signed -> active`, `expires_at` computed and
      stored → audit entry logged
- [ ] Wait past `expires_at` (use a short/accelerated value) → confirm
      the scheduled sweep flips it to `expired` with `actor = null`,
      with no manual action on your part
- [ ] Pull the full `audit_log` for this `warrant_id` and manually
      confirm the hash chain — each row's `prev_hash` should equal the
      previous row's `hash`

If every box above checks out, Xano's core (Phases 1 and 5) is real,
not just reference logic.

## 9. What's still open

- **Signature verification + anti-replay (Phase 3 Xano side) — not yet
  designed, not just "not yet built."** Phase 3 built and verified the
  Foxit client (`foxit_client.py`) end-to-end for creating and signing
  an envelope, but the Xano-side endpoint that receives the signed
  document back, verifies the signature, checks the warrant's `used`
  flag is still `false` (rejecting replay if `true`), and only then
  flips `used = true` and transitions `signed -> active` was **never
  written as a Python reference module** — there is no
  `warrant_verification.py` and no matching pytest file to check this
  against, unlike every other endpoint in this guide. Before building
  this in Xano, write and test the Python reference first (same
  pattern as `state_machine.py`/`audit_log.py`), then come back and add
  a §9a section here mirroring it. Building it directly in Xano without
  that reference risks silently reintroducing the exact replay bug this
  project's core security claim depends on catching.
- Live demonstration of hash-chain tamper detection against a real
  Xano table (Phase 7 "Stretch C" — deliberately editing a stored row
  via the Xano dashboard and showing the equivalent of
  `audit_log.verify_chain()` catch it). The hashing/chaining logic
  itself is implemented as of Phase 5 (§6 above, `audit_log.py`);
  Stretch C is the demo-video moment built on top of it, not new logic.
