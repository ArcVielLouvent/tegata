# Xano Verification Worksheet

`docs/xano-setup.md` tells you what to build. This file tells you
exactly what to type into Xano's **Run & Debug** panel for each
endpoint/function, and exactly what output to expect — copied directly
from the pytest reference cases, with pre-computed expected values so
you don't have to run Python yourself to get a comparison value.

**How to use this:** open each endpoint/function in Xano, click **Run &
Debug**, paste the input below, run it, and compare the output against
the "Expected" block. If it matches, tick the box. If it doesn't, the
Python reference (linked in each section) is the source of truth — fix
the Xano side.

---

## 1. `score` function (mirrors `risk_engine.py`)

### Case A — high risk
**Input:**
```json
{
  "resource": "db_payment_prod",
  "requested_duration_minutes": 1440,
  "request_time": "2026-08-29T23:00:00Z",
  "prior_high_risk_requests_in_window": 2
}
```
*(2026-08-29 is a Saturday — this deliberately exercises both the
weekend penalty and the off-hours penalty at once.)*

**Expected output:**
```json
{
  "score": 100,
  "tier": "high",
  "factors": {
    "resource_sensitivity": 50,
    "duration_factor": 30,
    "time_of_day_factor": 30,
    "requester_history_factor": 10
  }
}
```
*(50 + 30 + 30 + 10 = 120, capped at 100.)*

- [ ] Matches

### Case B — low risk
**Input:**
```json
{
  "resource": "internal_wiki",
  "requested_duration_minutes": 15,
  "request_time": "2026-08-24T10:00:00Z",
  "prior_high_risk_requests_in_window": 0
}
```
*(2026-08-24 is a Monday, 10am — business hours, weekday.)*

**Expected output:**
```json
{
  "score": 5,
  "tier": "low",
  "factors": {
    "resource_sensitivity": 5,
    "duration_factor": 0,
    "time_of_day_factor": 0,
    "requester_history_factor": 0
  }
}
```

- [ ] Matches

### Case C — unregistered resource (default sensitivity)
**Input:** any `resource` value not in `resource_tiers`
(e.g. `"some_new_resource_nobody_registered"`)

**Expected:** `resource_sensitivity` = **30** (the default), not an
error or a blank value.

- [ ] Matches

Full case list: `apps/agent/tests/test_risk_engine.py`

---

## 2. `derive_approval_requirement` function (mirrors `approval_rules.py`)

### Case A — high risk, requested duration exceeds the tier cap
**Input:** `tier="high"`, `requested_duration_minutes=240`

**Expected:** `required_approver_count=2`, `max_duration_minutes=60`
(capped down from 240 — the tier's hard limit, regardless of what was
requested)

- [ ] Matches

### Case B — high risk, requested duration is already under the cap
**Input:** `tier="high"`, `requested_duration_minutes=10`

**Expected:** `max_duration_minutes=10` (NOT extended up to 60 — the cap
never grants more than what was asked for)

- [ ] Matches

### Case C — medium risk
**Input:** `tier="medium"`, `requested_duration_minutes=1000`

**Expected:** `required_approver_count=1`, `max_duration_minutes=240`

- [ ] Matches

### Case D — low risk, full day
**Input:** `tier="low"`, `requested_duration_minutes=1440`

**Expected:** `required_approver_count=1`, `max_duration_minutes=1440`

- [ ] Matches

Full case list: `apps/agent/tests/test_approval_rules.py`

---

## 3. `validate_transition` function (mirrors `state_machine.py`)

### Valid transitions — must all succeed
| from | to |
|---|---|
| `requested` | `scored` |
| `scored` | `pending_approval` |
| `pending_approval` | `signed` |
| `pending_approval` | `expired_unapproved` |
| `signed` | `active` |
| `active` | `expired` |
| `active` | `revoked` |

- [ ] All seven succeed

### Invalid transitions — must all be REJECTED
| from | to | why it's invalid |
|---|---|---|
| `requested` | `active` | can't skip scoring/approval entirely |
| `scored` | `signed` | can't skip `pending_approval` |
| `pending_approval` | `active` | can't skip the `signed` step |
| `expired` | `active` | can't revive a terminal state |
| `revoked` | `active` | can't revive a terminal state |
| `expired_unapproved` | `pending_approval` | can't restart from a terminal state |
| `active` | `requested` | no going backwards |

- [ ] All seven are rejected (not silently allowed)

Full case list: `apps/agent/tests/test_state_machine.py`

---

## 4. `append_audit_log` function (mirrors `audit_log.py`)

This is the most failure-prone one — the canonical timestamp format and
JSON serialization must match **exactly**, or every hash will silently
disagree. Pre-computed expected hashes below (from a real Python run of
this repo's `audit_log.py`, 2026-08-27) let you check without needing
to run Python yourself.

### Case A — first entry in a chain (`prev_hash` is null)
**Input:** `warrant_id="w1"`, `event="requested"`, `entry_id="e1"`,
`timestamp="2026-08-25T10:00:00Z"`, `actor=null`, `prev_hash=null`

**The canonical string that gets hashed** (sorted keys, no whitespace):
```
{"actor":null,"event":"requested","prev_hash":null,"timestamp":"2026-08-25T10:00:00Z","warrant_id":"w1"}
```

**Expected SHA-256 hash:**
```
5cb9f99c09e456d8c5581b2b26b1deab884339c25674044ca058ea24c44f1873
```

- [ ] Matches exactly (64 hex characters, no truncation)

### Case B — second entry, links to the first
**Input:** `warrant_id="w1"`, `event="scored"`, `entry_id="e2"`,
`timestamp="2026-08-25T10:01:00Z"`, `actor=null`,
`prev_hash="5cb9f99c09e456d8c5581b2b26b1deab884339c25674044ca058ea24c44f1873"`
(Case A's hash)

**Expected SHA-256 hash:**
```
12bc978e9ac708720cb84d0bfe40e2aa9a567758fdadc0fccb80ba0b88465cf1
```

- [ ] Matches exactly

### Case C — with a non-null actor
**Input:** `warrant_id="w1"`, `event="signed"`, `entry_id="e3"`,
`timestamp="2026-08-25T10:02:00Z"`, `actor="alice"`,
`prev_hash="12bc978e9ac708720cb84d0bfe40e2aa9a567758fdadc0fccb80ba0b88465cf1"`
(Case B's hash)

**Expected SHA-256 hash:**
```
f150350642a5eb81a53c0bc7ee8e0a7aebed508403f0e178871ef47d44f44842
```

- [ ] Matches exactly

**If none of these match:** the timestamp format is the most likely
culprit. It must be **exactly** `YYYY-MM-DDTHH:MM:SSZ` — whole-second
precision (no milliseconds/microseconds), literal `Z` suffix (not
`+00:00`). Print out the exact string Xano is hashing and diff it
character-by-character against the canonical string shown above before
assuming the hash function itself is wrong.

Full case list (including tamper-detection and broken-link cases):
`apps/agent/tests/test_audit_log.py`

---

## 5. Scheduled task: `auto_expire_sweep`

Can't be tested via Run & Debug the same way (it's time-driven, not
input-driven). Instead:

1. Create a test `warrants` row with `status="active"` and
   `expires_at` set to a few seconds in the past.
2. Wait for the next scheduled tick (or trigger the task manually if
   Xano's UI allows it).
3. Confirm: `status` flipped to `expired`, and a new `audit_log` row
   was appended with `event="auto_expired"` and `actor=null`.
4. Create a second test row with `status="expired"` already (already
   terminal) and an old `expires_at`. Confirm the sweep does **nothing**
   to it (no error, no duplicate audit entry, no attempted transition)
   — this is the "safe repeated no-op" guarantee
   (`test_repeated_calls_after_expiry_stay_safe_no_ops` /
   `test_non_active_status_never_expires_even_if_time_passed`).

- [ ] Active + past-expiry row correctly auto-expires
- [ ] Already-terminal row is left alone (safe no-op)

---

## 6. End-to-end (see also `docs/xano-setup.md` §8)

Once sections 1–5 above all check out, walk one warrant through the
entire lifecycle by hand and confirm the audit trail's hash chain is
internally consistent end to end (each row's `prev_hash` equals the
previous row's `hash` — you now have real expected values from section
4 to sanity-check the mechanism itself before trusting a full run).

- [ ] Full lifecycle walk-through completed, hash chain verified
