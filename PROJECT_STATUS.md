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
- [x] Phase 3 — Signature & Verification (Foxit) — client + tests done, real API round-trip (create → sign → verify → download) not yet run
- [x] Phase 4 — AI Front-Door (Two-Pass NLU + 6-model fallback) — logic fully tested, real API calls not yet run
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

**Status: unblocked, third fix applied, not yet re-verified against the real API.** Next: re-run `scripts/verify_doctavian_template.py` (now uploads template + data, no `create_template()` call) with a fresh access token. If `GET_FILE_FROM_STORAGE_FAILED` persists even with `data.urn` populated, the next thing to check is whether `document.locale`/`document.timezone` (present in every official example but absent from our current call body) are secretly required too — add those next before escalating to Kanwal again.

Once unblocked: run `scripts/verify_doctavian_template.py` for real, confirm the Word IF field renders differently for high vs low risk. If it does NOT, the fix is isolated to `template_builder.py` only.

**UPDATE 2026-08-26 — CONCLUSIVELY DISPROVEN, real API evidence:** ran `scripts/verify_doctavian_template.py` for real, twice. First run used a bare `{}` data file — fixed per Kanwal's 2026-08-25 finding (needs a `"data"` wrapper key) — and `generate_document()` stopped erroring. Second run (this update) used a data file containing REAL flat key/value data (`resource`, `required_approver_count`, etc., matching the template's MERGEFIELD names) — still failed: both high- and low-risk documents came back with every merge field blank and identical static fallback text, raw XML showing the field codes completely untouched. Same-session control test (`scripts/smoke_test_expression_syntax.py`, also updated to use real data) proved plain-text `{!resource}` placeholders in the SAME data file DO get substituted correctly (`{!resource}` → `db_payment_prod` in the output). Conclusion, not a guess: **Doctavian's engine does not evaluate native Word MERGEFIELD/IF field codes under any data condition — it only substitutes plain-text `{!fieldname}` expressions.** Kanwal's data-wrapper fix was real and necessary (it explains why generation stopped erroring), but was never sufficient on its own — that read was premature.

**Still open, the actual remaining blocker:** the syntax for conditional/branching content (the whole point of Phase 2 — approval clause differs by risk tier) inside this plain-text expression system is unknown; Doctavian's "Elements Reference" docs page is JS-rendered and unreadable from Claude's sandbox. `scripts/smoke_test_conditional_syntax.py` added to test four plausible candidate syntaxes (`IF(...)` with `==`, `IF(...)` with `=`, Handlebars `{{#if}}`, ternary `? :`) in a single round-trip. **Not yet run.** If none pass, the only remaining path is asking Kanwal directly for the conditional syntax — we've now exhausted reasonable guessing on the substitution side and should not keep guessing indefinitely on the conditional side either.

**`template_builder.py` will need a full rewrite** once the conditional syntax is confirmed — native Word field generation there is now proven to be the wrong approach entirely, not just an edge case. Deliberately not rewriting it yet to avoid two rounds of changes; waiting for the conditional-syntax answer first so it's a single, final rewrite.

**Round 1 run 2026-08-26 (real API):** all four candidates failed. Result was informative though: candidates using the `{!...}` wrapper (`IF` with `==`, `IF` with `=`, ternary `?:`) all rendered as an **empty string** — not literal passthrough — meaning Doctavian's `{!...}` parser genuinely attempts to evaluate an expression and silently renders nothing when the function/operator isn't recognized. The Handlebars-style `{{#if}}...{{/if}}` candidate rendered **completely unchanged**, meaning `{{...}}` isn't recognized as syntax at all. `scripts/smoke_test_conditional_syntax.py` updated for round 2: testing `$IF`/`$IIF` (namespaced with `$`, based on the real `{!$now()}` example already documented in `doctavian_client.py`'s own module docstring). **Round 2 not yet run.** If round 2 also fails, stop guessing — escalate to Kanwal with the specific, confirmed findings above (this is now 7 candidates across 2 well-reasoned rounds, not random guessing).

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

**Next up: Phase 5 — Auto-Expire & Audit Trail.** See ROADMAP.md for scope (TTL job accelerated for demo, automatic transition to `Expired`, permanent audit log). This phase is mostly Xano-side logic (state machine already exists in `state_machine.py` from Phase 1 — Phase 5 is about triggering the `active -> expired` transition automatically after a TTL, plus building out the audit log storage) — likely needs the real Xano account finally set up (still not started, see `docs/xano-setup.md`).

**Merging status:** none of phase/2, 3, or 4 confirmed merged to the real GitHub `main` yet as of this session — check `github.com/ArcVielLouvent/tegata/branches` and merge via PR (see README/PROJECT_STATUS history for the established workflow: push branch, open PR on GitHub, wait for CI, merge via GitHub UI) before or alongside starting Phase 5, to avoid the branch chain growing even longer.

**Doctavian:** still blocked pending Kanwal's investigation (reproduction details sent 2026-08-24 with exact template file, data payload, and generate request body). Don't block Phase 5 on this — Xano and the auto-expire logic don't depend on Doctavian being fixed.
