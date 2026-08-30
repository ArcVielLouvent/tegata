# Project Status — Tegata

> This file is the project's "memory" that travels with the repo. Every new work session should start by reading this file, not by assuming.

**Last updated:** 2026-08-30
**Hackathon deadline:** September 3, 2026, 10:00 PDT — **4 days left as of this update**
**Target:** Foxit, Xano, Doctavian tracks + Overall Winner (DevNetwork [API+Cloud+AI] Hackathon 2026)

## ⚡ Quick Orientation — read this before anything else below

Detailed history follows chronologically further down this file (every
section header has a date). If you only have time to read one section,
read this one.

**What's CONFIRMED working end-to-end against real Xano (not mock)
right now:**
- Register (auto-logs in) / login, both roles (`requester` default,
  `approver` set manually in Xano's Database tab — see §9d in
  `docs/xano-setup.md`).
- Submit a request → real risk score, tier, approver count, all
  correctly displayed (`POST /score`).
- Warrant correctly reaches `pending_approval` (was stuck at `scored`
  forever until 2026-08-29's fix).
- `GET /warrants` returns real resource/reason/requested_by (was
  blank/"unknown" until 2026-08-29's fix) and supports a genuinely
  optional `status` filter.
- The **simplified** sign path (`POST /warrants/transition` directly to
  `active`, bypassing real Foxit) works for `required_approver_count===1`
  warrants: RBAC correctly blocks the requester from self-approving,
  correctly allows an `approver` account, and replay rejection works.

**What's IN PROGRESS, actively being debugged this session (2026-08-30)
— the REAL Doctavian+Foxit signing pipeline, not the simplified path
above:**
- `POST /api/documents/prepare` (Doctavian generate + Foxit
  createfolder) now succeeds for real — confirmed via a real successful
  response from Foxit (folder actually created, embedded signing
  session generated).
- `folderId`/`signingUrl` extraction from that real response was just
  fixed (commit "Fix folderId/signingUrl extraction with the CONFIRMED
  real Foxit response shape") — real keys are `envelope.folder.folderId`
  and `envelope.embeddedSigningSessions[0].embeddedSessionURL`, neither
  of which any earlier guess had tried.
- **NOT YET RETESTED after that fix.** The immediate next step for
  whoever picks this up: retest "Prepare & send for e-signature" on a
  `pending_approval` warrant with `required_approver_count===1`. If
  `attachEnvelope()` (calls Xano's `POST /warrants/attach-envelope`)
  and the embedded `<iframe>` both work, move on to actually signing in
  the iframe and clicking "I've signed — confirm" (calls Xano's
  `POST /warrants/confirm-signature`, §13c in `docs/xano-setup.md` —
  this endpoint's real Foxit-status-field name was never confirmed;
  the 2026-08-30 successful createfolder response shows
  `envelopeStatus`/`folderStatus` fields with value `"SHARED"`
  pre-signing, which is almost certainly the field to check for
  `"COMPLETED"` post-signing — pass this along to Xano if that
  endpoint's precondition still needs fixing).

**Known permanent limitation, not a bug:** any warrant stuck at status
`scored` (created before the `pending_approval` transition fix) can
never be signed — `scored -> active` is not a valid state-machine
transition and never will be. These show up in the Approver page's
collapsed "History" section. Fine to leave as clutter for now; delete
them from Xano's Database tab before recording a final demo video.

**Repo/branch state:** everything is on `phase/6-frontend-demo`, never
merged to `main`. This has been deferred since Phase 3 and should
happen once the real signing pipeline above is confirmed working, not
before.

**UI redesign (2026-08-30):** a Japanese-calligraphy visual pass
happened (brush-font kanji, refined palette, Approver page split into
"needs action" vs collapsed "history"). Armand's own assessment: doesn't
look meaningfully different from before, and may hand this specific
aspect to a different tool/AI rather than iterate further here. Don't
assume more visual-design requests are wanted unless explicitly asked
again — focus stayed on bug fixes after this feedback.

**Working style note for whoever picks this up:** this project's Xano
backend has been debugged almost entirely through a loop of (1) Claude
proposes a specific, copy-pasteable prompt for Armand to paste into
Xano's own AI agent, (2) Armand pastes the response back, (3) Claude
verifies the claim against actual test results rather than trusting
the description at face value (this caught real discrepancies multiple
times — e.g. a described `text? ticket_ref` turned out to behave
differently than described). Keep doing this — it's working. Do not
guess at Xano Function Stack internals or Foxit/Doctavian response
shapes; ask for the real thing, verify empirically (Armand can check
browser DevTools Network tab's Response — not just Payload — for any
call), and only fix based on confirmed data. This has been the single
most effective pattern this entire project.

## Concept Summary
See `docs/tegata-concept.md` for the full spec. In short: a time-boxed access authorization system where the LLM only proposes (NLU front-door), the system (hard schema validation + Xano) decides, Doctavian assembles a risk-scored conditional document, Foxit provides the two-way signing + verification layer, and everything auto-expires with a permanent audit trail.

## Phases Completed
- [x] Phase 0 — Repo Foundation
- [x] Phase 1 — Risk Engine + State Machine (reference implementation + tests; actual Xano Function Stack setup is a manual step you do — see `docs/xano-setup.md`)
- [x] Phase 2 — Conditional Document (Doctavian) — see detailed status below, one critical assumption still needs live verification
- [x] Phase 3 — Signature & Verification (Foxit) — client + tests done, real API round-trip (create → sign → verify → download) not yet run
- [x] Phase 4 — AI Front-Door (Two-Pass NLU + 6-model fallback) — logic fully tested, real API calls not yet run
- [x] Phase 5 — Auto-Expire & Audit Trail — reference implementation + tests done; real Xano scheduled task not yet built (manual step, see `docs/xano-setup.md` sections 7-8)
- [~] Phase 6 — Frontend Demo — in progress, see detailed status below (backend logic + UI + e2e tests written and passing everything runnable in Claude's sandbox; Playwright's actual browser run and real-Xano wiring still need to happen on your machine)
- [ ] Phase 7 — Stretch Features
- [ ] Phase 8 — Documentation & Submission

## Decisions Already Locked In (do not change without a strong reason)
- Stack: Python (agent/NLU) + Next.js/TypeScript (frontend) + Xano (backend/BaaS) + Foxit (e-sign) + Doctavian (documents)
- Core principle: what the human signs is exactly what the machine executes (no hidden payload)
- Two-pass LLM (extraction → self-check) followed by a hard schema gate — the LLM only proposes
- Testing: unit tests per phase + Playwright for frontend e2e
- Issue tracking: 1 issue per phase via `scripts/phase-sync.sh`, one branch per phase, CI per branch
- Project name: Tegata (final)
- All deliverables (README, docs, code, submission) in English — this is an international hackathon, not a national Indonesian one

## Still Needs Confirmation (do not assume, not yet answered)
- [ ] Is Foxit API access free for hackathon participants — no explicit info yet, need to email sponsor contact
- [ ] Is Doctavian API access free — implied "credentials fast" but not explicitly stated as free

## What Phase 0 Actually Built
- `packages/schema/tegata.schema.json` — canonical JSON Schema (single source of truth for data shapes)
- `packages/schema/python/models.py` — Pydantic models mirroring the JSON Schema, tested working
- `packages/schema/ts/schema.ts` — Zod schemas mirroring the same JSON Schema, tested working
- `tests/test_schema_consistency.py` + `tests/schema_consistency.test.ts` — cross-language tests that fail on purpose if Python/TS/JSON schema ever drift apart. These already caught one real bug during Phase 0 build (the `used` field was incorrectly marked required in the JSON Schema; fixed).
- `apps/agent/pyproject.toml` + `requirements.txt` — Python project config with ruff lint rules
- `packages/schema/ts/package.json` + root `package.json` (pnpm/npm workspace) — Node project config
- `.env.example` — placeholders for all sponsor + LLM credentials, none filled in yet
- `.gitignore` — covers secrets, node_modules, Python caches
- `scripts/phase-sync.sh` — tested against a mock `gh` CLI (start creates+labels an issue idempotently, done closes+relabels it, status prints a table). Not yet run against the real GitHub repo.
- `.github/workflows/phase-0.yml` — lints + runs both schema consistency test suites
- `.github/workflows/phase-issue-sync.yml` — auto-marks an issue in-progress on push to a `phase/N-*` branch, and done when that branch's PR merges to `main`. Branch-name-to-phase-number extraction regex tested against multiple cases.

## What Phase 1 Actually Built
- `apps/agent/src/tegata_agent/risk_engine.py` — risk scoring reference implementation (resource sensitivity, duration, time-of-day, requester history factors → score → tier)
- `apps/agent/src/tegata_agent/approval_rules.py` — derives required approver count + duration cap from risk tier, enforces the cap never grants more than what was requested
- `apps/agent/src/tegata_agent/state_machine.py` — explicit valid-transition table for `WarrantStatus`, rejects invalid transitions (e.g. skipping approval, reviving a terminal state)
- 44 passing unit tests across `test_risk_engine.py`, `test_approval_rules.py`, `test_state_machine.py` — including boundary cases (tier thresholds, duration capping, all invalid transition attempts) and a cross-check that state machine statuses match the schema enum
- `docs/xano-setup.md` — step-by-step guide to manually replicate this exact logic inside Xano's visual Function Stack (Xano is no-code — this logic cannot be "pushed" as a file, someone has to build it in their dashboard by hand)
- `.github/workflows/phase-1.yml` — lints + runs the full agent test suite

## What Phase 2 Actually Built
- `apps/agent/src/tegata_agent/template_builder.py` — generates the Tegata warrant `.docx` using **native Word IF merge fields** for the approval clause (branches on `required_approver_count`), not a guessed proprietary tag syntax
- `apps/agent/src/tegata_agent/doctavian_client.py` — `DoctavianClient` with `create_template()` and `generate_document()`, matching the **exact** request/response shapes from Doctavian's real Postman collection (not the partial OpenAPI spec, which we could only fetch part of)
- `apps/agent/src/tegata_agent/warrant_variables.py` — maps Phase 1's `RiskScore`/`ApprovalRequirement` output into Doctavian's `TemplateVariable` list
- `scripts/verify_doctavian_template.py` — a script to run in your Codespace (not runnable from Claude's sandbox — network egress there can't reach `demo.api.doctavian.com`) that registers the template and generates one high-risk + one low-risk document for you to manually confirm the approval clause text actually differs
- 20 new tests (75 total across the repo now... actually 55 in apps/agent alone), including an end-to-end test proving Phase 1 + Phase 2 together produce a genuinely different `required_approver_count` for high vs. low risk scenarios — this is the test backing "Wow Moment #1" in the concept doc

## CRITICAL — Unverified Assumption in Phase 2
**The whole conditional-document mechanism rests on one assumption that has NOT been tested against the real Doctavian API yet:** that their document-generation engine actually evaluates a native Word "IF" merge field as real conditional logic. This assumption exists because:
- Doctavian's public "Elements Reference" template-syntax guide is a JS-rendered page Claude could not read
- Their API's `docxLoadOptions: {"PreserveUnsupportedFeatures": true}` hints at real docx feature support, but this is inference, not confirmation

**Blocked as of 2026-08-22 — confirmed external blocker, not our error.** Read Doctavian's official Get Started + Quickstart docs in full (not just the OpenAPI spec/Postman collection). Their docs explicitly state every call requires BOTH `x-api-key` AND an OAuth 2.0 bearer token obtained via Postman's "Get New Access Token" (Microsoft/Google login tied to the Doctavian account itself, not a generic personal login). Kanwal's onboarding email only provided the `x-api-key` and described it as sufficient on its own — no OAuth client credentials or access token were provided for the "Team Tegata" demo account. Logging into demo.portal.doctavian.com with a personal Google account reaches the product UI (envelope creation, etc.) but does not yield an API-usable access token — that's a separate system.

**RESOLVED (2026-08-22):** got an access token manually via Postman's OAuth flow using a personal Microsoft account — the Entra ID app apparently accepts any Microsoft account, not just a specific tenant/demo identity. `DoctavianConfig.access_token` + `DOCTAVIAN_ACCESS_TOKEN` env var added; `DoctavianClient` now sends `Authorization: Bearer <token>` alongside `x-api-key`. Token is short-lived (~1hr observed) and must be manually regenerated via Postman when expired — no automated PKCE flow was built (their OAuth client's redirect_uri is locked to `oauth.pstmn.io`, so a custom flow can't complete login anyway).

**SECOND ISSUE FOUND AND RESOLVED (2026-08-22):** after auth was fixed, `generate_document()` failed with `500 GET_FILE_FROM_STORAGE_FAILED` when the template's `url` pointed to an external GitHub raw URL (confirmed publicly reachable — not an access problem). Root cause: `loadMethod: "Storage"` requires the file to physically live in Doctavian's own storage, not be referenced by an arbitrary external URL. Tried routing through `create_template()` with the uploaded file's storage id as `url`, but that field requires a well-formed absolute URI (`400 TEMPLATE_URL_INVALID` — a bare id isn't one, and no documented format exists for wrapping a storage id into a URI).

**Real fix, found by reading the user's Postman collection directly:** there is a dedicated `POST /v1/documents/template/upload` endpoint (`upload_template()` in the client) — separate from generic `/v1/documents/document/upload` — whose returned `id` is used **directly** as `generate_document`'s `template_urn`, with no `create_template()` step needed at all. Confirmed by Doctavian's own quickstart mission examples (Step 1c/Step 3 "Upload the template"), which save the response's file id straight into a `templateId` variable for immediate use. Important operational detail from their docs: **uploaded templates are automatically deleted from Storage after the next document-generation request that consumes them** — re-upload before every generation, do not cache/reuse a template id across multiple generate calls. `create_template()` is kept in the client for potential future use (permanent named templates) but is NOT part of Tegata's critical path and its `url` field format remains unconfirmed/untested.

**THIRD ISSUE FOUND AND RESOLVED (2026-08-22):** even with `upload_template()`'s id correctly used as `template_urn`, `generate_document()` still failed with the SAME `500 GET_FILE_FROM_STORAGE_FAILED`. Found via the same Postman collection: every real "Document Generate" example (including the official quickstart mission Step 5) always pairs `template.urn` with a `data.urn` from a **separate** upload — `POST /v1/documents/data/upload` (`X-Storage-Type: document-data`, `.json` files only, same single-use-then-deleted lifecycle as template upload). Our code was sending `data: {loadMethod: "Storage", variables: [...]}` with **no `urn` at all** — the API almost certainly tried to resolve a missing/empty data reference and threw the same generic storage error. Added `upload_data()` to the client; `verify_doctavian_template.py` now uploads a minimal `{}` JSON blob via this method and passes its id as `data_urn` alongside the inline `variables` (matching the official example, which uses both together).

Diagnostic results (curl against the real API), consistent with the documented requirement:
| Headers sent | Error returned |
|---|---|
| `x-api-key` only | `AUTHORIZATION_ERROR`: "Authorization header is missing." |
| `Authorization` only (any value) | `AUTHORIZATION_ERROR`: "Unauthorized ApiKeyNotFound" |
| Both `x-api-key` + `Authorization` (plain or `Bearer`) | `AUTHORIZATION_ERROR`: "Google token is invalid or expired." (misleading message — actually Microsoft/Entra ID, confirmed via the Postman collection's OAuth config) |

**FOURTH ISSUE — ACTUAL ROOT CAUSE, FOUND 2026-08-25 (Kanwal's investigation of the reproduction package sent 2026-08-24):** `TEMPLATE_READ_FAILED` was never about the template at all. Kanwal reproduced the exact failure using our **unmodified real template** (the native Word `IF` merge field from `template_builder.py`, untouched) and our real generate-document request, then fixed it by changing **only** the uploaded data file: our code was uploading a bare `{}` as the data JSON, but Doctavian's engine requires the file's contents to be wrapped in a top-level `"data"` key — even an empty one, i.e. `{"data": {}}`. With that one change, the document generated and downloaded successfully. Doctavian's team has acknowledged `TEMPLATE_READ_FAILED` is a misleading error name for what is actually a malformed-data-payload failure, and plans to improve the message.

**Two important implications:**
1. The native Word `IF` merge field approach in `template_builder.py` is confirmed correct — no rewrite needed. `scripts/smoke_test_expression_syntax.py`'s plain-text-placeholder hypothesis is now superseded; do not act on it (its header comment has been updated to say so).
2. `scripts/verify_doctavian_template.py` has been updated to upload `{"data": {}}` instead of `{}` — **fix applied but not yet re-run against the real API** (Claude's sandbox cannot reach `demo.api.doctavian.com`). Kanwal's two reference files (`data-simple.json`, the minimal fix; `mission-1-data.json`, a richer nested-data example from Doctavian's own Mission 1 quickstart) are saved under `docs/doctavian-samples/` for reference.

**Next action, high priority:** run `scripts/verify_doctavian_template.py` for real with a fresh `DOCTAVIAN_ACCESS_TOKEN`, confirm the Word IF field renders differently for high vs low risk as originally intended. If this succeeds, mark Phase 2 fully resolved — the "CRITICAL — Unverified Assumption" heading above can finally come down.

**UPDATE 2026-08-26 — real run completed, and it revealed a DEEPER problem than expected:** ran `scripts/verify_doctavian_template.py` for real. Both `generate_document()` calls (high-risk and low-risk) succeeded with **zero errors** — the `{"data": {}}` wrapper fix works, `TEMPLATE_READ_FAILED` is genuinely gone. **But** manually inspecting both downloaded documents (via Postman's document-download request, since `download_document()` didn't exist on the client yet at that point) showed every merge field blank in both documents, and both showing identical static fallback text ("ONE approver") regardless of risk tier. Raw XML confirmed the field codes themselves were completely untouched — same field count as the original template, no substitution attempted at all. **The earlier "mark Phase 2 fully resolved" framing above was premature.** Generation succeeding only proved the upload/generate/download pipeline works; it said nothing about whether Doctavian actually reads native Word MERGEFIELD/IF field codes as real templating logic — and the evidence now says it does not, at least not the way we called it.

**Response, same session:** added `DoctavianClient.download_document()` (endpoint confirmed directly from the real Postman collection's "Step 6 — Download the document" request: `GET /v1/documents/document/{id}/download`), so this whole loop is now fully scriptable — no more bouncing to Postman to inspect results. Rewrote `scripts/verify_doctavian_template.py` to automatically upload → generate → download → extract text → compare → print a clear PASS/FAIL, testing a narrower hypothesis first: maybe the fix isn't about Word fields at all, but about the uploaded data file needing **real key/value data** (not an empty `{}`) for Doctavian to read values from. Also reopened `scripts/smoke_test_expression_syntax.py` (previously and wrongly marked "superseded") — its original plain-text-placeholder hypothesis (`{!resource}` syntax) is back on the table given the new evidence, and it's now similarly automated to check actual substitution instead of just checking whether generation succeeds.

**Not yet run for real** (sandbox has no network access) — next session's first move should be running the rewritten `scripts/verify_doctavian_template.py` and reading its PASS/FAIL diagnosis. If it fails too, run `scripts/smoke_test_expression_syntax.py` next. If both fail, the only remaining path is asking Kanwal directly what syntax Doctavian's engine actually evaluates for variable substitution and conditional branching — we've now ruled out both native Word field codes with inline variables AND (pending the next run) native Word field codes with real data-file values.

## Separate fix (2026-08-25): audit-log hash timestamp format

While reviewing a Xano AI-agent-generated Function Stack for Phase 1/5
(`resource_tiers`/`requests`/`warrants`/`audit_log` tables, `score` /
`derive_approval_requirement` / `validate_transition` / `append_audit_log`
functions, matching endpoints, RBAC, and the `auto_expire_sweep` task —
see "Xano setup, first pass" section further below for the full review),
the Xano agent's own summary flagged that its hashing logic expects
timestamps formatted as `Y-m-d\TH:i:s\Z` (i.e. `2026-08-25T10:00:00Z`).

Checked against the Python reference: `audit_log.py` was using
`timestamp.isoformat()`, which for a UTC-aware datetime produces
`2026-08-25T10:00:00+00:00` — a `+00:00` suffix, not `Z`, and includes
microseconds when present. Either difference would make every audit-log
hash silently disagree between Xano and Python, even though both sides
are internally self-consistent. **Fixed:** `audit_log.py` now has a
`_canonical_timestamp()` helper that formats as `YYYY-MM-DDTHH:MM:SSZ`
(whole-second precision, explicit `Z`) before hashing. All 117 existing
tests still pass (no test hardcodes a literal expected hash string, so
this was a safe internal change). `docs/xano-setup.md` §6 now spells out
this exact format requirement instead of a vague "ISO 8601."

**Still needs doing:** actually feed identical inputs into the real
Xano `append_audit_log` function and confirm the hash matches the
Python reference byte-for-byte — this fix removes the most likely
silent mismatch, but hasn't been confirmed against the live endpoint
yet.

## Xano setup, first pass (2026-08-25) — built via Xano's own AI agent

Rather than clicking through `docs/xano-setup.md` by hand, this session
used Xano's built-in AI agent to generate the workspace. Result, per
screenshots reviewed:

- **Tables (4, matching the guide):** `resource_tiers`, `requests`,
  `warrants`, `audit_log`. (Two extra tables — `user` and `event_log` —
  came pre-seeded with the workspace template and are unrelated;
  harmless, no action needed.)
- **Functions (4, matching the guide 1:1):** `score` (mirrors
  `risk_engine.py`), `derive_approval_requirement` (mirrors
  `approval_rules.py`), `validate_transition` (mirrors
  `state_machine.py`), `append_audit_log` (mirrors `audit_log.py`,
  referenced by 2 endpoints + 1 task — i.e. it's wired in as a shared
  function, not just a standalone manually-triggered endpoint, which
  matches the guide's intent in §6).
- **Endpoints (5):** `POST /score`, `POST /derive-approval-requirement`,
  `POST /audit-log/append` (restricted to `security_admin`),
  `GET /warrants` (role-scoped — requesters see only their own),
  `GET /audit-log` (restricted to `security_admin`).
- **RBAC:** `user.role` enum extended with `requester` / `approver` /
  `security_admin`, enforced via `$auth.role` checks in endpoints.
- **Scheduled task:** `auto_expire_sweep`, every 1 minute, matching §7's
  logic (query active + past-expiry, validate transition, update
  status, append `auto_expired` audit entry).

**Assessment: structurally matches the plan well.** The 1-minute
scheduled-task interval is coarser than the guide's suggested 10-15s
for demo recording, but that's a Xano platform granularity choice, not
a bug — an `expires_at` a few seconds out will just wait up to ~1 minute
for the next sweep tick, which is still fine for a demo as long as the
video accounts for that latency (or the demo uses a duration long
enough that 1-minute sweep granularity isn't visually awkward).

**Not yet verified — this is the actual "is it done" test, still
outstanding:** none of the four functions or the scheduled task have
been exercised with the exact inputs from their corresponding pytest
files and checked for identical output. This is the real bar per this
project's established methodology (see the "Quick reference" table at
the top of `docs/xano-setup.md`), not "the Function Stack exists."
Concretely still to do:
- [ ] Feed `test_risk_engine.py`'s exact cases into the real `score`
      endpoint, confirm identical score + tier
- [ ] Feed `test_approval_rules.py`'s cases into
      `derive_approval_requirement`, confirm identical output
      (especially the duration-capping cases)
- [ ] Feed `test_state_machine.py`'s invalid-transition cases into
      `validate_transition`, confirm it rejects them the same way
- [ ] Feed `test_audit_log.py`'s cases into `append_audit_log`, confirm
      byte-identical SHA-256 hashes (this is where the timestamp-format
      fix above matters most)
- [ ] Walk one warrant through the full `docs/xano-setup.md` §8
      end-to-end checklist by hand

**Correctly NOT attempted:** no signature-verification/anti-replay
endpoint was built, consistent with `docs/xano-setup.md` §9's flag that
this has no Python reference or test file yet — building it blind in
Xano would risk silently reintroducing the exact replay bug this
project's core security claim depends on catching.

**UPDATE 2026-08-26 — CONCLUSIVELY DISPROVEN, real API evidence:** ran `scripts/verify_doctavian_template.py` for real, twice. First run used a bare `{}` data file — fixed per Kanwal's 2026-08-25 finding (needs a `"data"` wrapper key) — and `generate_document()` stopped erroring. Second run (this update) used a data file containing REAL flat key/value data (`resource`, `required_approver_count`, etc., matching the template's MERGEFIELD names) — still failed: both high- and low-risk documents came back with every merge field blank and identical static fallback text, raw XML showing the field codes completely untouched. Same-session control test (`scripts/smoke_test_expression_syntax.py`, also updated to use real data) proved plain-text `{!resource}` placeholders in the SAME data file DO get substituted correctly (`{!resource}` → `db_payment_prod` in the output). Conclusion, not a guess: **Doctavian's engine does not evaluate native Word MERGEFIELD/IF field codes under any data condition — it only substitutes plain-text `{!fieldname}` expressions.** Kanwal's data-wrapper fix was real and necessary (it explains why generation stopped erroring), but was never sufficient on its own — that read was premature.

**Still open, the actual remaining blocker:** the syntax for conditional/branching content (the whole point of Phase 2 — approval clause differs by risk tier) inside this plain-text expression system is unknown; Doctavian's "Elements Reference" docs page is JS-rendered and unreadable from Claude's sandbox. `scripts/smoke_test_conditional_syntax.py` added to test four plausible candidate syntaxes (`IF(...)` with `==`, `IF(...)` with `=`, Handlebars `{{#if}}`, ternary `? :`) in a single round-trip. **Not yet run.** If none pass, the only remaining path is asking Kanwal directly for the conditional syntax — we've now exhausted reasonable guessing on the substitution side and should not keep guessing indefinitely on the conditional side either.

**`template_builder.py` will need a full rewrite** once the conditional syntax is confirmed — native Word field generation there is now proven to be the wrong approach entirely, not just an edge case. Deliberately not rewriting it yet to avoid two rounds of changes; waiting for the conditional-syntax answer first so it's a single, final rewrite.

**Round 1 run 2026-08-26 (real API):** all four candidates failed. Result was informative though: candidates using the `{!...}` wrapper (`IF` with `==`, `IF` with `=`, ternary `?:`) all rendered as an **empty string** — not literal passthrough — meaning Doctavian's `{!...}` parser genuinely attempts to evaluate an expression and silently renders nothing when the function/operator isn't recognized. The Handlebars-style `{{#if}}...{{/if}}` candidate rendered **completely unchanged**, meaning `{{...}}` isn't recognized as syntax at all. `scripts/smoke_test_conditional_syntax.py` updated for round 2: testing `$IF`/`$IIF` (namespaced with `$`, based on the real `{!$now()}` example already documented in `doctavian_client.py`'s own module docstring). **Round 2 not yet run.** If round 2 also fails, stop guessing — escalate to Kanwal with the specific, confirmed findings above (this is now 7 candidates across 2 well-reasoned rounds, not random guessing).

**RESOLVED 2026-08-26 — Kanwal replied with the actual answer.** Full confirmation:
1. Merge field syntax `{!fieldname}` — confirmed correct, as we'd already found ourselves.
2. Native Word MERGEFIELD/IF field codes are never processed — "that's expected behavior, not a bug," per Kanwal. Our 2026-08-26 findings were correct, not a fluke.
3. Expressions use `{!$expression}` (Jexl-based). **No `IF()`/`IIF()` function exists** — this is why all 7 of our candidates failed, since we were guessing function names that don't exist. The correct mechanism for Tegata's use case (swap an entire sentence, not just a value) is Doctavian's `mdoc:paragraph` element: a whole paragraph shown/hidden via a `hidden="{!$expression}"` attribute. Two `mdoc:paragraph` blocks, each hidden under the opposite condition, implement the if/else.
4. Kanwal attached her own Mission 1 template (`mission-1-agreement.docx`) implementing this exact pattern for a volume-discount clause, plus PDF exports of the full Elements and Expressions references (previously inaccessible — the live docs page is JS-rendered). All saved to `docs/doctavian-samples/`.

**`template_builder.py` fully rewritten** (2026-08-26) to use the confirmed syntax: plain `{!fieldname}` merge fields, no OOXML field-code manipulation anywhere anymore, and two `mdoc:paragraph` blocks (`hidden="{!$required_approver_count != '2'}"` / `hidden="{!$required_approver_count == '2'}"`) for the approval clause — matching Kanwal's real example exactly, including the non-standard quirk that the **closing tag repeats the `name` attribute** (`</mdoc:paragraph name="twoApprovers">`, not just `</mdoc:paragraph>`).

`test_template_builder.py` fully rewritten to match (checks for the plain-text placeholders and `mdoc:paragraph` structure; includes an explicit regression guard — `test_template_uses_confirmed_doctavian_syntax_not_native_word_fields` — asserting `MERGEFIELD`/`fldChar`/`instrText` never reappear in the generated XML). `docs/templates/tegata-warrant.docx` regenerated from the new builder. `scripts/verify_doctavian_template.py` updated to reflect this is now a confirmatory regression check, not an open experiment. All 66 tests on this branch pass.

**Not yet re-run against the real API** (sandbox has no network access) — this is now genuinely the last step. Run `scripts/verify_doctavian_template.py docs/templates/tegata-warrant.docx` for real; a `PASS` diagnosis means Phase 2 is fully, finally done.

## Sponsor Credentials Status (update from earlier)
- [x] Doctavian — received. API key + demo base URL in `.env` (not committed). Postman collection used to build accurate client code.
- [ ] Foxit — received eSign API dashboard access (client_id/client_secret). Not yet wired into code (Phase 3).
- [ ] Xano — not yet started (self-serve, no blocker, needs a new API Group created once we start Phase 3 wiring)

## Not Yet Done / Known Gaps
- Doctavian template not yet actually uploaded/reachable by URL for the real API to fetch (their `create_template` needs a `url` pointing to hosted storage — decide where to host the generated `.docx`: a public GitHub raw link in this repo is the simplest option)
- Real Xano account/tables/Function Stack — manual step, not started (guide ready in `docs/xano-setup.md`)
- Foxit integration — Phase 3, not started
- `phase-sync.sh` still not run against a real GitHub repo/`gh` CLI

## Notes for the Next Session
Phase 0, 1, 2 (reference/tested logic) are done. Before Phase 3: (a) run `scripts/verify_doctavian_template.py` in Codespace to confirm the IF-field assumption, (b) decide where the `.docx` template will be hosted so Doctavian can fetch it by URL. Then Phase 3 wires up Foxit eSign: send the Doctavian-generated document for signature, verify the signature back in Xano, implement anti-replay.

## What Phase 3 Actually Built
- `apps/agent/src/tegata_agent/foxit_client.py` — `FoxitClient`: `create_envelope_from_binary()`, `get_envelope_details()`, `download_envelope_files()`, `cancel_envelope()`
- Auth: `client_id`/`client_secret` headers directly, per the **live working curl sample from this project's actual Foxit dashboard** (highest-confidence source — not a generic doc example). Note: the official public Postman collection (github.com/foxitsoftware/foxit-esign-postman-colllection) documents a DIFFERENT auth flow (OAuth2 client_credentials → bearer token) — that collection appears to target the older "eSignGenie" product line, not the unified Foxit Cloud API platform this account uses. Body/field/party shapes from that collection are still used (data format, independent of auth).
- `apps/agent/src/tegata_agent/foxit_test_pdf.py` — generates a minimal test PDF via `reportlab`. Unlike Doctavian, Foxit's signature fields are positioned by explicit x/y/width/height coordinates passed in the API call — no special tags need to be embedded in the PDF content itself.
- `scripts/verify_foxit_envelope.py` — real end-to-end verification script for Codespace: creates an envelope, waits for you to actually sign it via the emailed link, polls status until `EXECUTED`, downloads the signed ZIP, and prints the audit trail (`Folder History`).
- 6 new tests (69 total across the repo), matching exact response/error shapes from Foxit's real Postman collection examples.

## Not Yet Done / Known Gaps (updated)
- Foxit real end-to-end round-trip not yet run — need to execute `scripts/verify_foxit_envelope.py` with a real email address in Codespace
- Doctavian template.docx.locale/timezone fix not yet re-verified against real API (see Phase 2 section above)
- Real Xano account/tables/Function Stack — manual step, not started (guide ready in `docs/xano-setup.md`)
- `phase-sync.sh` still not run against a real GitHub repo/`gh` CLI

## Notes for the Next Session
Phases 0-3 have tested logic in place. Priority order: (1) run `scripts/verify_foxit_envelope.py` for real — this is likely to work smoothly given the simpler auth, (2) check back on the Doctavian TEMPLATE_READ_FAILED fix and/or Kanwal's reply, (3) once both Foxit and Doctavian are confirmed working end-to-end, wire them together (Doctavian generates the document → Foxit signs it → verify signature back) as the actual Tegata pipeline, which is currently built as two independent, tested-but-unconnected clients.

## What Phase 4 Actually Built
- `apps/agent/src/tegata_agent/llm_client.py` — `LLMClient` protocol + implementations: `AnthropicLLMClient` (standalone, not in default chain), `GeminiLLMClient`, `GroqLLMClient`, `OpenRouterLLMClient`, plus `FallbackLLMClient` (sequential fallback orchestrator) and `build_default_fallback_client()` (wires up 2 models each from Gemini/Groq/OpenRouter = 6 total, in that order)
- `apps/agent/src/tegata_agent/nlu_frontdoor.py` — the two-pass pipeline: `extract_request()` (pass 1), `self_check_extraction()` (pass 2), `validate_and_build_request()` (the hard gate — deterministic Pydantic + resource whitelist, NOT the LLM), `process_natural_language_request()` (runs all three in sequence)
- **Critical design point**: fallback is sequential (try model 1, fall through to model 2 on any exception, etc.), not parallel — deliberately kept simple given time constraints; parallel racing was considered and explicitly deferred as a possible Phase 7 stretch item, not core scope
- 17 new tests (86 total across the repo): 8 for fallback orchestration logic (using fakes, no real API needed), 9 for the NLU pipeline (using a `FakeLLMClient`) — including the critical demo-moment test: a prompt-injection attempt that BOTH LLM passes naively "agree" with is still rejected by the hard gate
- `scripts/verify_nlu_frontdoor.py` — real API verification script; unlike Doctavian/Foxit, this doesn't need Codespace-only network access (Gemini/Groq/OpenRouter aren't blocked in most sandboxes) but still needs YOUR API keys, which Claude doesn't have
- Model names hardcoded as defaults (Gemini: gemini-2.5-flash/gemini-2.0-flash, Groq: llama-3.3-70b-versatile/llama-3.1-8b-instant, OpenRouter: two :free-tier models) are **unverified against current provider lineups** — check each provider's docs (linked in code comments) before the demo, these change often

## Not Yet Done / Known Gaps (updated)
- LLM fallback chain: **verified against real APIs 2026-08-24** — normal request accepted correctly, prompt-injection attempt correctly rejected by the hard gate (and independently flagged by the LLM's own self-check pass too). `gemini-3.6-flash-lite` (2nd Gemini model) still unverified — only `gemini-3.6-flash` was actually exercised in the successful run; if the chain ever falls through to the 2nd Gemini slot, watch for whether that name is right.
- Foxit real end-to-end round-trip: **fully confirmed 2026-08-24** — envelope created, signed by hand (real signature, "Armand al-farizy", Foxit account is in trial mode hence the "TEST MODE" watermark on the output, which is expected and not a bug), audit trail showed Created → InviteSentTo → (signing completed).
- Doctavian TEMPLATE_READ_FAILED: reproduction details sent to Kanwal (template file, data payload, exact generate request body) — waiting on her team's investigation.
- Real Xano account/tables/Function Stack — manual step, not started (guide ready in `docs/xano-setup.md`)
- `phase-sync.sh` still not run against a real GitHub repo/`gh` CLI
- Minor: a `pydantic.ArbitraryTypeWarning` about `<built-in function any>` appeared during a real run — grepped the codebase for a stray lowercase `any` type hint and found nothing obviously wrong (the only match was a code comment). Likely from a pydantic/fastapi internal interaction, not confirmed as a real bug. Low priority — revisit if it ever causes an actual failure, not just a warning.

## Notes for the Next Session
Phases 0-4 have tested logic in place, AND Phases 3-4's core mechanisms are now confirmed working against real APIs (Foxit signing loop, LLM fallback + hard gate). This branch (`phase/4-ai-frontdoor`) was built off `phase/3-foxit`, which was built off `phase/2-doctavian` — so it contains ALL prior phase commits linearly.

**Next up (as of the prior session): Phase 5 — Auto-Expire & Audit Trail.** See ROADMAP.md for scope (TTL job accelerated for demo, automatic transition to `Expired`, permanent audit log). This phase is mostly Xano-side logic (state machine already exists in `state_machine.py` from Phase 1 — Phase 5 is about triggering the `active -> expired` transition automatically after a TTL, plus building out the audit log storage) — likely needs the real Xano account finally set up (still not started, see `docs/xano-setup.md`).

**Merging status (at start of this session):** none of phase/2, 3, or 4 confirmed merged to the real GitHub `main` yet — still true as of this session's end. `phase/5-auto-expire` was branched from `phase/4-ai-frontdoor`, so it also contains phases 2, 3, 4 linearly, same pattern as before. Before or alongside starting Phase 6: merge phase/2 → phase/3 → phase/4 → phase/5 to `main` via separate PRs (recommended, for cleaner review) or merge the phase/5 tip in one PR (simpler, same end result in `main`) — check `github.com/ArcVielLouvent/tegata/branches` first to confirm nothing changed. Local dev is now VS Code (no more Codespaces — billing ran out), so PR pushes happen from your own machine now, not a Codespace terminal.

**Doctavian:** still blocked pending Kanwal's investigation (reproduction details sent 2026-08-24 with exact template file, data payload, and generate request body). Did not block Phase 5 — Xano and the auto-expire/audit-log logic don't depend on Doctavian being fixed. Check your email for a reply before starting Phase 6.

## What Phase 5 Actually Built
- `apps/agent/src/tegata_agent/ttl.py` — `compute_expires_at()` (turns an activation timestamp + `max_duration_minutes` into an `expires_at`, with an optional `acceleration_seconds_per_minute` param for compressing a demo recording — see `.env.example`'s `DEMO_TTL_ACCELERATION_SECONDS`), `is_expired()`, `seconds_until_expiry()` (for a future Phase 6 UI countdown)
- `apps/agent/src/tegata_agent/audit_log.py` — `append_entry()` builds a hash-chained `AuditLogEntry` (SHA-256 over a canonical, sorted-keys JSON representation of the entry's content + the previous entry's hash), `verify_chain()` detects a tampered field or a broken `prev_hash` link. **Note on scope:** the schema already required `prev_hash`/`hash` as of Phase 0, so this hashing logic is base Phase 5 scope — Phase 7 "Stretch C" is specifically the *live demo* of corrupting a real Xano row and catching it on camera, built on top of this primitive, not new hashing logic.
- `apps/agent/src/tegata_agent/auto_expire.py` — `check_and_expire()`: pure function tying `state_machine.py` (Phase 1) + `ttl.py` + `audit_log.py` together. Given a warrant's current status and `expires_at`, decides whether to transition to `expired` right now, routes the actual transition through `state_machine.validate_transition()` (single source of truth, not a duplicated rule), and builds the `auto_expired` audit entry with `actor=None` (system-triggered, no human). Designed to be called repeatedly/idempotently by a scheduled sweep — always a safe no-op on anything not currently `active`, or not yet past `expires_at`.
- `docs/xano-setup.md` — added sections 7 (Function Stack for `POST /audit-log/append`, including the exact canonical-JSON serialization Xano's Function Stack must match to produce identical SHA-256 hashes to the Python reference) and 8 (the scheduled-task sweep that mirrors `check_and_expire()` against every `active` warrant row)
- `scripts/verify_auto_expire_demo.py` — real-time verification script (same spirit as `verify_foxit_envelope.py`/`verify_nlu_frontdoor.py`, but calls no external API since Phase 5 has none). Builds a real hash-chained audit trail through to `active`, computes an accelerated `expires_at`, then polls with actual `time.sleep()` in genuine wall-clock time — NOT an injected `now` like the pytest suite — until it auto-expires with zero human action, then verifies the full chain. **Actually run 2026-08-25** (`--minutes 1 --accel 1 --poll 1`): confirmed the real-time cycle completes and auto-expires exactly as expected. This is also the literal script to run while screen-recording Wow Moment #3 for the demo video (docs/tegata-concept.md section 6).
- 22 new tests (139 total across the repo): `test_ttl.py` (9), `test_audit_log.py` (9 — including tamper-detection and broken-link-detection cases), `test_auto_expire.py` (7, plus a parametrized "safe no-op on every non-active status" case) — including an explicit end-to-end test using the exact accelerated-TTL scenario described in ROADMAP.md's Phase 5 "done when" criteria (15-second demo window)
- `.github/workflows/phase-5.yml` — lints + runs the three new test files

## Not Yet Done / Known Gaps (updated)
- Real Xano scheduled task for the auto-expire sweep — manual step, not started (guide ready in `docs/xano-setup.md` section 8)
- Real Xano Function Stack for `POST /audit-log/append` — manual step, not started (guide ready in `docs/xano-setup.md` section 7); in particular, the canonical-JSON serialization must be verified to produce byte-identical hashes to the Python reference before trusting it
- Doctavian: real root cause found 2026-08-25 (data payload missing its `"data"` wrapper key — see Phase 2 section above), fix applied to `scripts/verify_doctavian_template.py`, **not yet re-run against the real API**
- Foxit real end-to-end round-trip: confirmed working (see Phase 3/4 notes above)
- `phase-sync.sh` still not run against a real GitHub repo/`gh` CLI
- None of phase/2 through phase/5 merged to the real GitHub `main` yet (see "Merging status" above)
- Xano: first-pass workspace built via Xano's own AI agent (see "Xano setup, first pass" section above) — structurally matches the plan, but **not yet verified against any pytest reference case**

## Notes for the Next Session
Phases 0-5 have tested reference logic in place, plus Phase 3/4's core mechanisms confirmed against real APIs. `phase/5-auto-expire` was branched from `phase/4-ai-frontdoor`, so it linearly contains every prior phase's commits.

**Immediate priorities, in order:**
1. **Re-run `scripts/verify_doctavian_template.py` for real** with a fresh `DOCTAVIAN_ACCESS_TOKEN` — the actual root cause of `TEMPLATE_READ_FAILED` was found and fixed this session (see Phase 2 section above), this just needs a real confirmation run. If it succeeds, the Doctavian blocker that's dragged on since Phase 2 is finally, genuinely closed.
2. **Verify the Xano workspace (built via Xano's AI agent this session) against the pytest reference cases** — see the checklist under "Xano setup, first pass" above. Structurally it looks right, but nothing has actually been fed through it and compared to `test_risk_engine.py` / `test_approval_rules.py` / `test_state_machine.py` / `test_audit_log.py` yet. Pay special attention to the audit-log hash — the timestamp-format fix applied this session (`Z` suffix, whole-second precision) needs to be confirmed against the live `append_audit_log` function, not just assumed fixed.
3. **Merge the branch chain to `main`** via GitHub UI (push `phase/5-auto-expire`, open a PR, wait for `phase-5.yml` CI green, merge) — this has been deferred multiple sessions running and the chain keeps growing; do this once 1-2 above are confirmed, before piling Phase 6 on top.
4. **Phase 6 — Frontend Demo** (Next.js) is next up per ROADMAP.md once Xano is verified and reachable — a UI can't meaningfully demo against reference-only Python logic or an unverified Xano workspace, it needs the actual confirmed-correct Xano API endpoints.

**Worth doing once the Xano scheduled task is confirmed correct:** re-run `scripts/verify_auto_expire_demo.py`'s logic (or a Xano-side equivalent) against the real `auto_expire_sweep` task, to confirm it behaves identically to the Python reference in real time, not just in pytest. Note the real task runs every 1 minute (Xano platform granularity), coarser than the guide's suggested 10-15s — fine for a demo as long as the recording accounts for up to ~1 minute of sweep latency.

**Still completely unaddressed, flagged since Phase 3:** the Xano-side signature-verification + anti-replay endpoint (checks the Foxit-signed document, verifies the warrant's `used` flag, flips it, transitions `signed -> active`) has no Python reference implementation or test file yet, unlike everything else in this project. Correctly not attempted in this session's Xano build either. Needs its own reference module (mirroring the `state_machine.py`/`audit_log.py` pattern) before it's safe to build in Xano — see `docs/xano-setup.md` §9.

**Environment note:** working from local VS Code, not GitHub Codespaces (billing ran out) — this doesn't change anything about the Doctavian/Foxit network restrictions (those were about Claude's own sandbox, not Codespaces specifically), but any workflow notes that assumed a Codespace terminal should be read as "your local machine" instead going forward.

## What Phase 6 Actually Built

**The §9 gap (flagged since Phase 3) is now closed at the reference-implementation level:**
- `apps/agent/src/tegata_agent/warrant_verification.py` — signature verification + anti-replay logic. Checks, in order: (1) `used` flag (anti-replay — checked before the envelope is even inspected, on purpose), (2) envelope fully `EXECUTED`, (3) document hash + signer email match what was sent for signature, (4) delegates the actual `signed -> active` transition to `state_machine.validate_transition` (no duplicated transition rules). `test_warrant_verification.py` — 17 tests. **Full regression: 137/137 pass.**
- A second, previously-unflagged gap was found while starting this phase: there was also no `POST /warrants` (create/persist) endpoint anywhere — `score` and `derive_approval_requirement` only compute values in isolation, nothing hands back a `warrant_id`. Documented as a new gap.
- `docs/xano-setup.md` §9a (`POST /verify-signature` spec, mirrors `warrant_verification.py`) and §9b (`POST /warrants` spec, pure persistence — reuses `score`/`derive_approval_requirement`, no new business logic) added. **Neither endpoint exists in the live Xano workspace yet** — this is the main blocker for real-Xano-mode below.

**`apps/web` — Next.js 14 (App Router) frontend, three views:**
- Requester (`/`) — submit a request, see the risk score + tier + required approver count immediately (Wow Moment: differing approver count for low vs. high risk).
- Approver (`/approver`) — list warrants, sign them (tracks partial signatures when `required_approver_count` is 2), and a second "Sign" click on an already-active warrant demonstrates the anti-replay rejection **visibly in the UI** — banner text, not just an API error in a network tab (Wow Moment / ROADMAP's explicit Phase 6 "done when" line).
- Audit trail (`/audit/[warrantId]`) — renders the hash-chained entries and a chain-integrity banner.
- `lib/referenceLogic.ts` — a literal TypeScript port of `risk_engine.py`/`approval_rules.py`/`state_machine.py`/`audit_log.py`/`ttl.py`/`warrant_verification.py`. Not a separate reimplementation — same constants, same formulas, same ordering of checks.
- `lib/mockStore.ts` + `/api/mock/*` route handlers — an in-memory backend built on `referenceLogic.ts`, used when `NEXT_PUBLIC_API_MODE=mock` (the default).
- `lib/apiClient.ts` — single adapter switching between `/api/mock/*` and a real Xano base URL via `NEXT_PUBLIC_API_MODE`; once §9a/§9b exist in Xano, flipping this env var is the only change needed, no frontend code changes.
- **Manually smoke-tested against a real running `next start` server in Claude's sandbox** (not just unit-level): create → sign → activate → replay attempt → confirmed `403 replay_rejected` → confirmed audit chain has exactly one `signed_and_activated` entry and `chain_intact: true`. Full curl transcript available on request if you want to re-verify before trusting it.
- `npx tsc --noEmit` clean, `npx next build` succeeds.

**`tests/e2e/`** — Playwright, two spec files (`happy-path.spec.ts`, `replay-rejection.spec.ts`) plus `playwright.config.ts` (runs `apps/web` in mock mode on port 3100). **Typechecked clean in Claude's sandbox but the actual browser run was NOT possible there** — Claude's sandbox network is restricted and cannot reach `cdn.playwright.dev` to download the Chromium binary. This is the one thing that still needs to happen on your machine before Phase 6 can honestly be marked done — see immediate priorities below.

`scripts/verify_phase6_frontend.sh` — the real (non-pytest) verification script: installs deps, installs Playwright's Chromium, typechecks, runs the full Python regression, then runs Playwright against a real browser. Supports `--mode=xano` for once §9a/§9b exist. **Ran successfully through Step 4 (typecheck + full pytest regression) in Claude's sandbox; Step 5 (actual Playwright browser run) could not run there** for the same network-restriction reason as above — run it yourself locally, that's the actual pass/fail signal for this phase.

`.github/workflows/phase-6.yml` — three jobs: agent regression (pytest+ruff), frontend typecheck+build, and Playwright e2e in mock mode (GitHub Actions runners aren't network-restricted the way Claude's sandbox is, so this job should actually work in CI even though it couldn't run locally in this session).

**Auth wiring added (2026-08-28), after discovering Tegata Core is Private:**
- `lib/auth.ts` — client for the separate "Authentication" API group (its own base URL, confirmed via Xano's "API URLs" panel — NOT the Swagger Docs panel, which is just documentation). `POST /auth/signup` and `POST /auth/login` confirmed to return `{authToken}`; `GET /auth/me` confirmed Private, needs the bearer token.
- `lib/AuthContext.tsx` + `lib/AuthStatus.tsx` — React context wrapping the whole app (in `app/layout.tsx`), persists the token to `localStorage` (fine here — this is a real delivered app, not an Artifact, which has a separate stricter no-localStorage rule), hydrates on load, exposes `login()`/`register()`/`logout()`.
- `app/login/page.tsx` — register (name/email/password) and login forms. In mock mode this page just explains login isn't needed there, rather than pretending to work.
- Requester and Approver pages now guard on `needsLogin` in xano mode and pull the signed-in user's email instead of a free-text field (Xano ignores whatever `requested_by`/`signer_email` you send anyway and uses `$authenticated_user.email` server-side, per §9a/§9d).
- **Confirmed gap, not a bug:** `/auth/signup` has no `role` input — every new account defaults to `requester`. There is no self-service way to become `approver`/`security_admin`; that's set manually by editing the user's row in Xano's Database tab. `docs/xano-setup.md` §9d documents this.
- Mock mode is completely unaffected by any of this — smoke-tested again after the auth changes (create → sign → activate → replay-rejected all still pass via curl against a real `next start` server).

## Not Yet Done / Known Gaps (updated 2026-08-28)
- **Run `./scripts/verify_phase6_frontend.sh` for real, on your machine** — still the main open item. Nothing about mock-mode logic is expected to fail (smoke-tested via curl repeatedly, including after the auth changes), but an actual Playwright browser run is the real bar.
- **`--mode=xano` has never actually been run against the live workspace yet** — the contract is confirmed correct on paper (§9a/§9b/§9d in `docs/xano-setup.md`, verified by reading the real Function Stacks via Xano's AI agent), and `apiClient.ts`/`auth.ts` are written to match it exactly, but nobody has clicked through the actual login → request → sign flow in a browser against real Xano yet. Do this before assuming it works.
- xano mode's 2-approver flow is still only a manual/smoke-test shortcut (see `apiClient.ts`'s `signWarrant()` xano-mode comment) — it doesn't call a real Foxit envelope, so "1 of 2 signed" progress has no real equivalent yet.
- Everything carried over from Phase 5's gaps (auto-expire scheduled task, `/audit-log/append` Function Stack, Doctavian re-verification, `phase-sync.sh` never run against real GitHub, nothing merged to `main` yet) is still exactly as open as it was.
- `apps/web`'s mock backend is intentionally in-memory and resets on server restart — fine for a demo, not persistence.

## Restructured plan going forward (Armand's call, 2026-08-28 — recorded here so it isn't lost)
Phase 6 is now understood as three sub-stages, not one block:
1. **Test Xano** (current stage) — confirm each Xano contract piece by piece against real endpoints, fix `apiClient.ts`/`auth.ts` to match. In progress; see immediate priorities below.
2. **Integrate everything from Phases 1-5** — wire Phase 4's NLU front-door, Phase 2's Doctavian document generation, and Phase 3's real Foxit signing into this same `apps/web` UI (today it bypasses all three: the Requester page is a manual form, not NLU-driven, and Approver's "Sign" doesn't touch a real Foxit envelope). Also close out anything still open from Phases 1-5 specifically (see the gaps list above and each phase's own "Not Yet Done" section higher in this file).
3. **Phase 7** — build + test the stretch features (ROADMAP.md's actual list: OCR self-consistency check, dual-audience document generation, progressive disclosure via redaction, synthetic canary warrant — hash-chained audit log is already done, Phase 5), and connect them into the same Phase 6 UI rather than treating them as separate demos.

Phase 8 remains documentation + submission (README, benchmarks, testing docs, demo video, Devpost) — there is no separate "combine everything" phase beyond what 2-3 above already are.

## Notes for the Next Session
**Immediate priorities, in order:**
1. **`./scripts/verify_phase6_frontend.sh` cannot run on Armand's machine** (AMD A4-9152/Radeon R3 — not enough headroom for Playwright's Chromium + a Next.js dev server at once) — CI (`e2e-mock-mode` in `phase-6.yml`) is the actual pass/fail signal for this phase's e2e tests, not a local run. Push to `phase/6-*` or open a PR and read the Actions tab.
2. **Manually walk through `--mode=xano` in a real browser**: register → (manually set role=approver on a second test account in Xano's Database tab) → submit a request as the requester account → sign as the approver account → confirm activation → attempt to sign again → confirm the replay rejection banner appears with the right wording. This is the first time this flow will have actually run against live Xano.
3. Re-verify the already-flagged Xano discrepancies from the earlier verification pass (`resource_sensitivity` for `db_payment_prod` — should be fixed now that `seed_resource_tiers` ran, confirm it actually shows 6 rows — the `internal_wiki` medium-vs-low scoring case, audit-log hash mismatches from contaminated test data, `auto_expire_sweep` needing manual trigger).
4. Once 1-3 are solid, move to stage 2 of the restructured plan above (wire NLU front-door / Doctavian / Foxit into this same UI, close out Phase 1-5 loose ends) before starting Phase 7.
5. **Merge the branch chain to `main`** — deferred since Phase 3, keeps growing. Do this once the above is stable, not before.

## CI fix: e2e-mock-mode was flaky, not broken (2026-08-28)

After pushing the auth-wiring commit, `e2e-mock-mode` in `phase-6.yml`
failed on GitHub Actions: `warrant-card` not found, status stuck at
`pending_approval`, `signed_and_activated` count 0 in the replay test.
This was **not** a mock-backend logic bug and **did not** need any
Doctavian/Foxit/Xano secrets in GitHub Secrets — the job only ever
talks to this app's own `/api/mock/*` routes, never the network.

Root cause: `tests/e2e/playwright.config.ts`'s `webServer` ran
`npm run dev`, and Next.js dev mode compiles each route on first
request. On a cold GitHub Actions runner, first-hit compile time for
`/approver`, `/audit/[id]`, and the sign API route raced against
Playwright's 5s assertion timeout — worse after this session's auth
wiring added more first-load surface (`AuthContext`, `/login`) to
compile.

Fix (`tests/e2e/playwright.config.ts`, commit after `df2d184`):
`webServer.command` now runs `npm run build && npm run start`
(production, all routes precompiled) instead of `npm run dev`.
Confirmed via a real `next start` + curl smoke test in Claude's
sandbox: reset → create (`w_0001`, low risk, 1 approver) → sign →
`status: active` → replay sign → `403 replay_rejected` → audit trail
shows exactly one `signed_and_activated` entry, `chain_intact: true`.
First-hit route latency in production mode: <160ms (vs. multi-second
dev-mode compiles). Production build takes ~32s locally in the
sandbox, well inside the new 180s `webServer.timeout`. Also added
`expect.timeout: 8000` and `retries: 1` (CI only) as variance
headroom — not a substitute for the actual fix.
`ruff check` + full `pytest` regression (137/137) re-run clean;
`apps/agent` untouched by this fix.

**Still the actual bar for this specific fix:** a real browser run
via GitHub Actions on `phase/6-frontend-demo` or `main` — the sandbox
curl smoke test proves the mock backend and build are sound, but
only CI can run actual Chromium against actual Playwright assertions
here.

## Hybrid real-signing pipeline (Doctavian + Foxit + Xano) — built 2026-08-29

Following up on the CI fix and ticket_ref fix above: built the real
signing pipeline for `required_approver_count === 1`, as a deliberate
**hybrid** so all three sponsor integrations (Xano, Foxit, Doctavian)
are genuinely used, not just one:

- **`apps/web/app/api/documents/prepare/route.ts`** (Node.js runtime) —
  orchestrates the one step that's a binary pass-through between two
  external APIs (Doctavian generates a doc -> download bytes -> upload
  those bytes to Foxit as an envelope) — not practical as a Xano
  Function Stack step, which is built for JSON in/out.
  `lib/doctavianClient.ts` and `lib/foxitClient.ts` are server-only TS
  ports of `doctavian_client.py`/`foxit_client.py` (same endpoints,
  same header shapes — copied, not re-derived).
- **Xano stays the source of truth and does the actual verification**:
  `docs/xano-setup.md` §13 specs two new endpoints for Xano's AI agent
  to build — `/warrants/attach-envelope` (stores the real
  `document_id`/`document_hash`/`foxit_folder_id` right after step 1)
  and `/warrants/confirm-signature` (calls Foxit's real
  `GET /folders/myfolder` **from Xano itself**, server-to-server, and
  only activates the warrant if Foxit's real status says fully signed
  — replacing the old `/warrants/transition` shortcut that just
  trusted a client-supplied `envelope_status` string). NOT YET BUILT
  in the actual Xano workspace — this is a spec for Armand to feed to
  Xano's AI agent next.
- **Approver page**: pending_approval + required_approver_count===1 in
  xano mode now shows "Prepare & send for e-signature" ->
  `prepareSignature()` + `attachEnvelope()` in one click -> an inline
  `<iframe>` embedding Foxit's real embedded-signing URL ("web in web",
  not a new-tab link — `createEmbeddedSigningSession: true`) -> "I've
  signed — confirm" -> `confirmSignature()`. `signWarrant()` (the old
  client-trusted shortcut) is now the fallback ONLY for
  `required_approver_count === 2`, which this pipeline doesn't cover
  yet.
- Mock mode is completely untouched — smoke-tested end to end after
  every change in this session, still 200/201 throughout.

**Explicitly UNVERIFIED (flagged in code comments, not silently
assumed) — first things to check on the first real run, once
DOCTAVIAN_ACCESS_TOKEN/FOXIT_ESIGN_* are set in `apps/web/.env.local`
and §13's two Xano endpoints exist:**
1. Whether Doctavian's `generate_document` actually honors
   `documentFileFormat: "pdf"` from a `.docx` template.
2. The real field name holding the embedded signing URL in Foxit's
   `create_envelope_from_binary` response (`extractSigningUrl()` in
   `foxitClient.ts` guesses several plausible keys).
3. The signature-field pixel position (`x: 100, y: 650` — a guess,
   never checked against a real generated envelope).
4. Whether Foxit's embedded-signing URL permits being framed in an
   `<iframe>` at all (X-Frame-Options/CSP).
5. The real field name for "fully executed" in
   `get_envelope_details`'s response (§13c step 5) — this one Xano's
   AI agent will hit first, since it's the endpoint that has to be
   built from scratch rather than ported from working Python.

**Next session priorities, in order:** (1) feed docs/xano-setup.md
§13 to Xano's AI agent, build the two endpoints; (2) set real
DOCTAVIAN_ACCESS_TOKEN + FOXIT_ESIGN_* in apps/web/.env.local and run
the Requester -> Approver flow for real, once, to resolve the 5
UNVERIFIED items above; (3) only then decide whether
`required_approver_count === 2` gets a real Foxit sequential-signing
flow too, or stays on the `signWarrant()` shortcut for the rest of the
hackathon (time-box this — Sept 3 is close).

## Phase 4 NLU front-door wired into the demo UI (2026-08-29)

Following the hybrid signing pipeline above: ported
`nlu_frontdoor.py` + `llm_client.py` to TS
(`lib/nluFrontdoor.ts`, `lib/llmClient.ts`) and wired them into a new
`POST /api/nlu/parse` route. Unlike the Doctavian/Foxit pipeline, this
one stayed entirely in Next.js — it's pure LLM-call + validation logic
with no persistent state and no binary pass-through, so there's no
Xano-specific reason to spec a Function Stack for it (§13's split was
specifically about binary data; this has none).

- Requester page (`app/page.tsx`) now has a free-text box above the
  form ("Describe what you need") -> "Fill form from description" ->
  calls `/api/nlu/parse` -> fills `resource`/`reason`/
  `requested_duration_minutes`/`ticket_ref` into the existing form
  fields. Nothing is submitted automatically — the user still has to
  review and click "Submit request" themselves, same "AI proposes,
  system decides" principle as the Python original's docstring. If
  the LLM's self-check pass flags a concern (e.g. suspected prompt
  injection asking for unlimited access), it's shown as a visible
  warning banner rather than silently swallowed.
- Hard validation gate (`validateAndBuildRequest` in
  `nluFrontdoor.ts`) is a straight port of the Python gate: resource
  must be in the same whitelist `referenceLogic.ts` already uses for
  mock-mode scoring (`RESOURCE_SENSITIVITY`'s keys) — deterministic,
  no LLM involved, rejects regardless of what either LLM pass
  concluded.
- Fallback chain ported 1:1 from `llm_client.py`: 2 Gemini -> 2 Groq ->
  2 OpenRouter models, same model names (same UNVERIFIED flag carried
  over on `gemini-3.6-flash-lite` — never independently confirmed in
  the Python original either).

Verified: tsc --noEmit clean, next build clean (new
`/api/nlu/parse` route shows up in the build output), smoke-tested
both error paths (`config_error` with no provider key set,
`validation_failed` with no `text`) — can't smoke-test an actual LLM
call from this sandbox (no network access to Gemini/Groq/OpenRouter).
Mock mode re-confirmed unaffected. Full Python regression 137/137,
ruff clean.

**Still UNVERIFIED, same reason as the signing pipeline (no network
access to the real providers from this sandbox):** the actual Gemini/
Groq/OpenRouter response shapes this file assumes
(`data.candidates[0].content.parts[...].text` for Gemini,
`data.choices[0].message.content` for Groq/OpenRouter — these are the
standard documented shapes for each API, not independently tested
here). Set GEMINI_API_KEY/GROQ_API_KEY/OPENROUTER_API_KEY in
`apps/web/.env.local` and try a real free-text request as the next
concrete verification step, same session as the signing pipeline's 5
UNVERIFIED items.

**All of Phase 0-5's systems are now wired into `apps/web` in some
form** (risk engine: mock mode's own scoring + Xano's `/score`;
Doctavian+Foxit: `/api/documents/prepare` + Xano §13; auto-expire:
already in `state_machine.py`/mock's `ttl.py` port; NLU front-door:
this). What's left is verification against the real external services
(Xano AI's two endpoints, Doctavian, Foxit, and now the LLM
providers) — none of it is buildable further from this sandbox
without real network access, so the next session's job is running
these live, not writing more code blind.

## Independent audit of the "full integration" claim above (2026-08-29)

Armand asked for this to actually be checked, not taken on faith. Went
file-by-file (`doctavianClient.ts`/`foxitClient.ts`/`warrantVariables.ts`
diffed against their Python originals line-by-line; `nluFrontdoor.ts`
diffed against `nlu_frontdoor.py`; the real `tegata-warrant.docx`
template unzipped and grepped for its actual `{!field}`/`hidden=`
expressions rather than trusting the docstring's description of it).

**Confirmed genuinely faithful, not just claimed:**
- Doctavian/Foxit clients: endpoint paths, header names, body field
  names (`emailId` not `email`, `allowNameChange: false`, etc.),
  response-parsing paths (`result.data.files[0]`,
  `result.data.document`) all match the Python originals exactly.
- `warrantVariables.ts` matches `warrant_variables.py` field-for-field.
- `apps/web/assets/tegata-warrant.docx` — MD5-identical to
  `docs/templates/tegata-warrant.docx` (the confirmed-correct template
  from the Phase 2 Doctavian-syntax resolution). Verified by unzipping
  and grepping the actual `document.xml`: uses `{!fieldname}` syntax
  (not native Word MERGEFIELD — zero matches), and its
  `hidden="{!$required_approver_count == '2'}"` /
  `!= '2'` pair genuinely drives the "document structure changes with
  risk" story the NLU/warrant-variables docstrings claim — this isn't
  an unused variable, the template actually branches on it.
- `nluFrontdoor.ts`'s prompts are copied verbatim from
  `nlu_frontdoor.py` (diffed character-for-character).
- The `openrouter/free` model repeated twice in `llmClient.ts` looked
  like a copy-paste bug at first glance — it's not; the Python
  original does the exact same thing intentionally (no second free
  slug exists to pin).

**Real bugs found and fixed this pass:**
- **`apiClient.ts`'s `getWarrant()`** assumed a single-record
  `GET /warrants/{warrant_id}` endpoint exists in Xano. It was never
  confirmed to exist — only the LIST endpoint (`GET /warrants`) was
  ever verified. This would have 404'd on every visit to
  `/audit/<warrant_id>` in xano mode (the exact page Armand's own
  step-5 manual test plan above ends on), and on `signWarrant()`'s
  legacy fallback path. Fixed: `getWarrant()` now fetches the
  confirmed-working list and filters client-side instead of assuming
  the single-record endpoint exists.

**Still-unconfirmed assumption, flagged but not fixed (can't fix
blind):** `getAuditLog()` calls `GET /audit-log?warrant_id=<id>`,
assuming the query parameter is literally named `warrant_id`. The
endpoint's existence is confirmed (Xano dashboard showed "1 input, 3
functions"), but the actual input parameter's name was never
confirmed. If the audit trail page in xano mode comes back empty or
errors, check this first — open the endpoint in Xano's dashboard and
confirm the input name matches.

**New Xano-side bug found live (not a frontend issue — confirmed by
reading `apiClient.ts`'s actual request body, which correctly sends
`ticket_ref` as a plain string like `"JIRA-999"`):** submitting a
request with a real (non-empty) `ticket_ref` value returns
`Invalid filter: trim` from `/score`. Works fine with `ticket_ref: ""`
(the fallback c32c317 sends when the field is left blank), breaks with
a real value — meaning something in `/score`'s Function Stack applies
a `|trim` filter to `ticket_ref` (or a field affected by it) in a way
that only fails for a non-empty value. This needs to be diagnosed
directly in Xano's Function Stack — nothing in this repo can fix it
blind. See the exact diagnostic prompt given to Armand in-chat.


## Approver page showing "No requests yet" for a warrant that really exists (2026-08-29)

Armand hit this live, both accounts (requester and approver), right
after a warrant was confirmed successfully created via POST /score
(Image 1 of his report — MEDIUM RISK, score 46, all fields correct).
Real bug, in `unwrapWarrantList()` — the *list* counterpart of the
unwrap function `db136ab` added for the single-warrant case, but with
the opposite failure behavior: `unwrapWarrant()`/`normalizeWarrant()`
throw a loud diagnostic when nothing recognizable is found;
`unwrapWarrantList()` silently returned `[]`. An unrecognized GET
/warrants response shape and a genuinely empty list were
indistinguishable — both just showed "No requests yet", no error, no
clue.

Fixed: `unwrapWarrantList()` now returns `undefined` (not `[]`) when
none of the known shapes match; `listWarrants()` throws a diagnostic
ApiError with the raw response attached in that case. The Approver
page's `refresh()` now actually catches this (it previously had no
catch block at all for this call) and shows it as a visible banner.
A real empty list (bare `[]`, `{warrants: []}`, etc.) still displays
"No requests yet" normally — only a genuinely unrecognized shape is
now loud.

**Next real test should show either the warrant on the Approver page,
or (if the response shape is still wrong) a red banner with the raw
JSON** — either way, more information than before. If it's the
banner, send the raw shape and the key list gets fixed for real
instead of guessed a third time.

## Gemini model name fix (2026-08-29)

`gemini-3.6-flash-lite` (this repo's original guess) was confirmed
wrong — real error from testing: 404 NOT_FOUND. Armand searched and
found the real current lineup; independently re-confirmed via web
search (ai.google.dev, 2026-08-29): `gemini-3.7-flash` (GA, shipped
2026-08-13, newest flagship) and `gemini-3.5-flash-lite` (GA, real
lite-tier model) are both real, current model IDs. Swapped
`llmClient.ts`'s Gemini pair to these two. Also switched from
`?key=` query-param auth to the `x-goog-api-key` header, matching
Google's current documented curl example for gemini-3.7-flash exactly
(both work, this just matches what's actually documented now).

Groq's `401 Invalid API Key` and OpenRouter's `429` from Image 2 are
NOT code bugs — Groq's error is unambiguous (the key string itself
isn't accepted, independent of account age), and OpenRouter's
rate-limit was on `z-ai/glm-4.5:free`'s shared upstream free pool
(that's a limit on the whole free-tier model's demand across all
users, not tied to how old Armand's own account/key is — a
brand-new key can still hit it). Things to check for the Groq key
specifically: no leading/trailing whitespace or quotes when pasted
into `.env.local`, and — since Armand is running `next build` +
`next start` rather than `next dev` — a full restart of the `next
start` process after any `.env.local` edit (server-only env vars are
read at process start, same restart requirement as `next dev`, just
less obvious when the workflow is build-once-serve).

## Session summary, 2026-08-30: Foxit real-signing pipeline debugging + UI redesign

Long session, many small fixes chained together as each one revealed
the next. In order:

1. **`normalizeWarrant()` field mapping fixed against a CONFIRMED
   verbatim `GET /warrants` response** (Xano's dev pasted the actual
   raw JSON — first time seen, not guessed). Two real bugs this
   revealed: the four `factor_*` fields have different names AND order
   than this repo's own `ScoreBreakdown` type (was silently falling
   through to a hardcoded `{0,0,0,0}` for every real warrant), and
   `created_at`/`expires_at` are epoch milliseconds, not ISO strings.
   Also confirmed NOT a frontend bug: `resource`/`reason`/`requested_by`
   were genuinely absent from the response at the time (Xano hadn't
   added the join yet) — this was later fixed Xano-side same session.

2. **Foxit `createEnvelopeFromBinary` rewritten from multipart to
   `inputType:"base64"`.** The real 403 Armand hit was a wrong upload
   method entirely, not bad credentials (separately confirmed via a
   live curl test with the same client_id/client_secret against a
   different endpoint, which worked). Foxit's own dashboard quickstart
   only shows `inputType:"url"` (fetching from a public URL — not
   usable here, Doctavian generates the PDF in-memory with no public
   hosting). Confirmed the base64 method via Foxit's official docs plus
   independent third-party integration examples. Enriched
   `Party`/`SignatureField` shape to match Foxit's real dashboard
   sample (`tabOrder`, `partyResponsible` were missing entirely). Also
   fixed `handleResponse()`: only checked an error's `message` field,
   missing the CONFIRMED real field name `error_description` (from the
   same curl test) — every prior Foxit error was likely showing a
   generic fallback instead of Foxit's actual stated reason. Also
   handles Foxit returning a body-level `{result:"error"}` with HTTP
   200 rather than a 4xx status.

3. **`embeddedSignersEmailIds` added.** The base64 rewrite immediately
   surfaced (correctly, thanks to fix #2's error_description handling)
   a real Foxit error: `createEmbeddedSigningSession:true` needs a
   *separate* `embeddedSignersEmailIds` array — not implied by the
   boolean flag alone. Confirmed via Foxit's documented example.

4. **`folderId`/`signingUrl` extraction fixed against a CONFIRMED real
   successful `createfolder` response** (Foxit actually created a real
   folder+envelope+embedded signing session this time — first genuine
   success). Real keys, neither guessed correctly before:
   `envelope.folder.folderId` (not top-level, not under `result` — that
   field is a plain string `"success"`) and
   `envelope.embeddedSigningSessions[0].embeddedSessionURL` (an array
   of per-signer sessions keyed by `emailIdOfSigner`, not
   `embeddedSigningUrl`/`signingUrl` at any level tried before).
   Verified by writing the exact real JSON into a standalone Node
   script and running the actual extraction functions against it
   directly, not just eyeballing the code. `prepare/route.ts` also now
   fails loudly (502 + full `raw_envelope` in the response) if
   extraction ever fails again, instead of silently sending `null`
   downstream to Xano where it surfaces as a confusing, seemingly
   unrelated "Missing param" error.

5. **UI redesign** (Japanese calligraphy visual identity): brush-font
   kanji (Yuji Mai, loaded via `<link>` not `next/font/google` so the
   build doesn't need network access to Google's font CDN), refined
   washi/sumi/hanko/ai palette, Approver page split into "needs your
   action" (sorted newest-first) vs. a collapsed "history" section
   (warrants permanently stuck at `scored`, or otherwise resolved).
   **Armand's own assessment: didn't feel meaningfully different from
   before** — may hand this specific aspect to a different tool. Don't
   invest further design effort here unless explicitly asked again.

**Xano-side fixes confirmed published this same session** (via the
Claude-proposes-prompt / Armand-pastes-response / Claude-verifies loop
described in the Quick Orientation section above): the `|trim`-on-null
crash in `function/score.xs`'s history-lookup query (moved
normalization out of the `db.query` where-clause into a local
variable), `ticket_ref` genuinely optional (`text? ticket_ref?` — two
`?`s, one for nullable-value, one for optional-key, a real XanoScript
distinction that isn't obvious), `append_audit_log` no longer requires
callers to supply `prev_hash` (looks up the previous entry internally
now), `/score` now actually transitions `scored -> pending_approval`
(was silently stopping at `scored` forever before this), `GET
/warrants` now joins in `resource`/`reason`/`requested_by` and its
`status` filter is genuinely optional (`text? status?`, same two-`?`
pattern as ticket_ref), and `POST /auth/signup` accepts an optional
`role` (restricted to `requester`/`approver` only, never
`security_admin`) used exclusively by the e2e test's direct API call,
never exposed in the actual login/register UI.

**Not done, not attempted this session:** merging `phase/6-frontend-demo`
to `main` (still deferred, see Quick Orientation above), Phase 7
stretch features, anything related to submission materials (Phase 8).

## Branch reconciliation + CI/session fixes (2026-08-31)

Three separate sessions had built forward from the same commit
(`d32c87b`) without ever syncing: (1) this branch's own confirmed
folderId/signingUrl fix + Quick Orientation notes, (2) a parallel
session's "Sekisho Ledger" visual redesign v2 + frontend `RoleGate`
RBAC gate, (3) a parallel `phase/7-stretch-features` branch. All three
are now reconciled: this branch (`phase/6-frontend-demo`) carries (1)
and (2) — the confirmed-working signing fix plus the redesign and
RBAC gate, cherry-picked in that order so the confirmed fix wasn't
accidentally reverted by the older code the other two branches forked
from. Phase 7's commits are cherry-picked on a separate branch,
stacked on this one, to be resumed later — not merged in here.

**Root cause of the CI failure from the earlier Playwright run,
confirmed by reading the actual render logic (not guessed):** the v2
redesign moved any warrant not in `{"pending_approval", "signed"}` —
including "active" — into a "History" section wrapped in a native
`<details>` element, collapsed by default. Both failing tests needed
to interact with elements that only exist on an already-active
warrant (the audit-trail link, the replay-attempt sign button) — both
now sit inside that collapsed `<details>`, which genuinely hides its
content until opened. Playwright correctly found the elements in the
DOM and correctly reported them as not visible; this was never a
flaky-CI issue. Fixed by giving `<summary>` a
`data-testid="history-toggle-summary"` and having both specs click it
open before interacting with anything inside — the same thing a real
user has to do.

**Session-refresh bug ("logged in, refreshed the page, got treated as
unauthorized"), two real causes found in `apps/web/lib/`, not a Xano
issue:**
1. `RoleGate.tsx` computed `role = user?.role || "requester"` without
   checking `useAuth()`'s own `loading` flag first. On a hard refresh,
   `AuthContext`'s token restore (`getStoredToken()` -> `fetchMe()`)
   is async, so `user` is briefly `null` even though a valid token
   sits in localStorage the whole time — during that window this
   defaulted everyone to `"requester"`, showing "This screen isn't for
   your role" to a real approver refreshing `/approver`. Fixed:
   returns `null` while `loading` is true.
2. `AuthContext.tsx` cleared the stored token on ANY `fetchMe()`
   failure, not just an actual 401/403. `auth.ts`'s own module
   docstring already flagged `NEXT_PUBLIC_XANO_AUTH_ME_PATH` as an
   unconfirmed guess at Xano's real path — if that guess is wrong (or
   there's a transient network/CORS hiccup), every refresh would
   silently throw away a perfectly good token and force a real
   re-login. Fixed: only clears the token on a confirmed 401/403;
   anything else surfaces as a retryable error instead.

**Not a bug (clarified by Armand 2026-08-31):** `audit_log` never
having a `requested_by`-style field is expected — that data lives on
the separate `requests`/`warrants` tables, `audit_log` only records
the event chain (`actor`, `event`, `prev_hash`, `hash`, `timestamp`).
No fix needed here; removed from the open-issues list.

**Verified this session:** `tsc --noEmit` (apps/web) clean, `next
build` clean (the font-stylesheet minify warning during build is
Claude's sandbox network egress restriction on
`fonts.googleapis.com`, not a real error — GitHub Actions' runner has
normal network access), Python regression 137/137 (`apps/agent`),
both schema-consistency tests (Python + TS) passing when run with the
same `PYTHONPATH`/`ts-node` flags `.github/workflows/phase-0.yml`
actually uses. **NOT verified:** the e2e Playwright run itself —
Claude's sandbox can't install Playwright's browser binaries (blocked
by the same network egress restriction), so the collapsed-`<details>`
fix is confirmed by reading the render logic and matching it exactly
against the CI failure's error output, not by re-running the suite.
Run `npm run test:e2e` locally or push to CI to get that final
confirmation before merging to `main`.

## Phase 7 branch opened (2026-08-30) — separate from Phase 6, stacked on top of it

Per Armand's instruction: Phase 7 gets its OWN branch
(`phase/7-stretch-features`) rather than being folded into Phase 6's
commits, but it's branched from Phase 6's current tip (`d32c87b`,
NOT `main`) since Phase 6 still has open bugs (see the section right
above this one and the "Still open (Xano-side...)" notes in the
`eafd9eb`/`05c39ef`/`d32c87b` commit messages) and hasn't merged to
`main` yet. `.github/workflows/phase-7.yml` added, mirroring the
Phase 0-6 CI pattern (Python regression + TS typecheck/build) — no
feature-specific job yet since nothing below has real code in this
branch yet.

**SECURITY REMINDER carried over from `05c39ef`'s commit message,
not yet acted on:** Armand pasted real Foxit `client_id`/
`client_secret` values in chat while sharing dashboard sample code
for diagnosis. Treat those as exposed — rotate them in the Foxit
dashboard, independent of whether Phase 6's signing pipeline is
confirmed working yet.

### Phase 7 scope, in `docs/tegata-concept.md`'s own suggested order (C→B→E→A→D)

`docs/tegata-concept.md` §7 explains the ordering rationale: hash-chain
and OCR-check "most directly reinforce the core security argument and
are cheapest to build," redaction/canary "need more additional state."
ROADMAP.md's numbered list is priority order too but doesn't carry
this reasoning — recorded here so it isn't lost again.

1. **Hash-chained audit log demo (Xano)** — the hashing PRIMITIVE
   already exists and is tested (`audit_log.py`, built in Phase 5 —
   see that file's own SCOPE NOTE docstring, added this session to
   stop this from getting "rediscovered" as un-built). What Phase 7
   actually adds: the live demo moment — deliberately corrupt a stored
   row in the real Xano `audit_log` table, show `verify_chain()`-style
   detection catch it on camera. Needs: a Xano-side `/audit/verify`
   (or similar) endpoint exposing the same check server-side, wired to
   a UI element.
2. **OCR self-consistency check (Foxit)** — re-run Foxit's OCR on a
   generated PDF's rendered output, compare against the original text/
   metadata layer; a mismatch signals a layer-mismatch attack. No
   groundwork exists yet. Needs Foxit's OCR/text-extraction endpoint
   confirmed (same "read real docs first" rule as the signing
   pipeline — don't repeat the multipart-vs-base64 guessing mistake).
3. **Dual-audience document generation (Doctavian)** — one data
   payload, two documents: the formal warrant (existing) + an internal
   runbook for the on-call engineer (technical, copy-paste-ready,
   expiry reminders). `template_builder.py`/`doctavian_client.py`'s
   `generate_document()` already supports arbitrary templates — this
   is mostly a second template + a second `generate_document()` call
   with the same variables, not new client code.
4. **Progressive disclosure via redaction (Foxit)** — for a 2-approver
   (high-risk) warrant, technical clauses stay redacted until the
   first signature, then a less-redacted v2 regenerates for the second
   approver. Needs Foxit's redaction API confirmed (unexplored so
   far) and a second document-generation pass triggered by the
   first-signature event.
5. **Synthetic canary warrant (Xano)** — a scheduled Xano task sends a
   fake low-risk warrant through the full pipeline (through Doctavian,
   up to signature-ready in Foxit) as a live health check. Needs a
   Xano scheduled-task endpoint; otherwise reuses everything else
   already built.

**Not started in this branch yet** — this commit is scaffolding only
(branch + CI). Phase 6's own open bugs (GET /warrants "Missing param:
status", /score not transitioning to pending_approval, the generic
"Precondition failed" on /warrants/transition, Foxit's createfolder
end-to-end not yet confirmed working) are Phase 6 concerns and stay
tracked there, not duplicated into this section — Phase 7 stretch work
assumes Core is stable, per `tegata-concept.md`'s own scope-discipline
rule, so realistically none of items 1-5 above should get real code
until those are resolved.
