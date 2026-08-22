# Project Status — Tegata

> This file is the project's "memory" that travels with the repo. Every new work session should start by reading this file, not by assuming.

**Last updated:** 2026-08-21 (Phase 0 complete)
**Hackathon deadline:** September 3, 2026, 10:00 PDT
**Target:** Foxit, Xano, Doctavian tracks + Overall Winner (DevNetwork [API+Cloud+AI] Hackathon 2026)

## Concept Summary
See `docs/tegata-concept.md` for the full spec. In short: a time-boxed access authorization system where the LLM only proposes (NLU front-door), the system (hard schema validation + Xano) decides, Doctavian assembles a risk-scored conditional document, Foxit provides the two-way signing + verification layer, and everything auto-expires with a permanent audit trail.

## Phases Completed
- [x] Phase 0 — Repo Foundation
- [x] Phase 1 — Risk Engine + State Machine (reference implementation + tests; actual Xano Function Stack setup is a manual step you do — see `docs/xano-setup.md`)
- [x] Phase 2 — Conditional Document (Doctavian) — see detailed status below, one critical assumption still needs live verification
- [ ] Phase 2 — Conditional Document
- [ ] Phase 3 — Signature & Verification
- [ ] Phase 4 — AI Front-Door
- [ ] Phase 5 — Auto-Expire & Audit Trail
- [ ] Phase 6 — Frontend Demo
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

**Blocked as of 2026-08-22 — this is an external blocker, not incomplete work on our side.** Attempted to run `scripts/verify_doctavian_template.py` against the real demo account. Diagnosed via curl (see below) that `POST /v1/documents/template/create` requires BOTH `x-api-key` AND a real Google OAuth token in `Authorization` — the demo account Kanwal set up was described as "just pass x-api-key" but the actual endpoint still enforces the full OAuth flow from their customer-facing docs (which explicitly says personal accounts aren't supported for that flow).

Diagnostic results (curl against the real API):
| Headers sent | Error returned |
|---|---|
| `x-api-key` only | `AUTHORIZATION_ERROR`: "Authorization header is missing." |
| `Authorization` only (any value) | `AUTHORIZATION_ERROR`: "Unauthorized ApiKeyNotFound" |
| Both `x-api-key` + `Authorization` (plain or `Bearer`) | `AUTHORIZATION_ERROR`: "Google token is invalid or expired." |

Follow-up email sent to Kanwal (kanwal.roshi@mavenmule.com) with this exact table, asking for either a way to get a valid token without full Google OAuth signup, or a different endpoint intended for the x-api-key-only flow. **Waiting on response — do not block other phases on this.**

Once unblocked: run `scripts/verify_doctavian_template.py` for real, confirm the Word IF field renders differently for high vs low risk. If it does NOT, the fix is isolated to `template_builder.py` only.

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
