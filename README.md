# Tegata (手形)

> *"Every access is a journey. Every journey needs a tegata."*

A time-boxed privileged access authorization system, where every request is distilled into a risk-scored document, signed by a human before any critical action happens, and automatically expires without needing manual revocation.

Built for the **DevNetwork [API + Cloud + AI] Hackathon 2026** — targeting the **Xano**, **Foxit Software**, and **Doctavian** tracks, and eligible for **Overall Winner**.

---

## Why the name "Tegata"?

**Tegata (手形)** is a Japanese word carrying two stacked meanings that fit this project almost literally:

1. **Travel permit** — during the Edo period, a *tsūkō tegata* (通行手形) was a document required for travelers to pass through a *sekisho* (checkpoint). Officials verified its authenticity and only allowed passage within what was written on it.
2. **Handprint / signature** — the historical root of the word is a document authenticated by a handprint as a mark of agreement.

This system is literally a combination of both: a document authenticated by a signature, functioning as a scope- and time-limited pass, checked at a digital "checkpoint" before access is granted.

Full concept write-up in [`docs/tegata-concept.md`](docs/tegata-concept.md).

---

## Core Principle

> **What the human signs is exactly what the machine executes.**
> No hidden payload. The AI proposes, the system (hard validation) decides.

---

## Flow Overview

```
Free-text request
        │
        ▼
  [Agent NLU — two-pass]  ← LLM extraction → LLM self-check
        │
        ▼
  [Hard schema validation]  ← NOT the LLM — the real gatekeeper
        │
        ▼
  [Risk scoring + approval requirement]  ← resource sensitivity, time, duration, history
        │
        ▼
  [Doctavian: risk-scored conditional document]  ← genuinely different clauses per tier
        │
        ▼
  [Foxit eSign: human signature]  ← architecturally can't be bypassed by an agent
        │
        ▼
  [Xano: state machine, RBAC, hash-chained audit log, auto-expire]
        │
        ▼
  [The actual gated resource]  ← re-checked against Xano fresh on every access,
                                  not a client-side flag — see "The enforcement
                                  proof" below
```

---

## The enforcement proof

Every other "access granted" moment in a demo like this risks being just a
status field changing color in a dashboard — something anyone with database
access can edit by hand, proving nothing about real enforcement. Tegata
includes an actual protected endpoint (`GET /api/resource/[resource]`,
demoed at `/resource/internal_wiki`) that independently asks Xano, fresh, on
every single request, whether the caller currently holds an active,
unexpired warrant for that exact resource — before releasing anything.
Nothing about that decision is cached or trusted from the client. Try
loading it before requesting access (denied), after your request is signed
(granted, with a live expiry timestamp), and after it expires (denied again,
automatically, without anyone touching the database).

---

## What's built (Phase 7, current)

Beyond the core flow above:

- **RBAC across every endpoint** — a `requester` only ever sees their own
  requests and audit trail; role-gated actions (transitioning a warrant,
  attaching an envelope, confirming a signature) reject anyone but
  `approver`/`security_admin`. Verified with real cross-account tests, not
  just read from the Function Stack.
- **Tamper-evident audit log** — every entry is a SHA-256 hash of its own
  content plus the previous entry's hash; a `GET .../audit/verify` endpoint
  independently recomputes and confirms the whole chain, and
  `scripts/verify_audit_chain_endpoint.py` cross-checks Xano's answer
  against a second, independent local recomputation rather than trusting
  either one alone.
- **Anti-replay** — signing an already-active warrant again is rejected,
  not just hidden by the UI.
- **Progressive disclosure** — a warrant's document withholds technical
  execution details (the literal grant command) until a first approver has
  signed, via Doctavian's own conditional-paragraph templating.
- **Dual-audience document generation** — the same warrant generates both a
  formal grant document and a separate operator runbook with copy-pasteable
  commands.
- **OCR self-consistency check** — verifies a generated PDF's actual visible
  text matches the facts it was supposed to be built from.
- **Extension requests** — requesting more time on an active warrant creates
  a brand-new linked request needing its own approval; the original grant
  is never silently modified.
- **Synthetic canary** — a scheduled task exercises the scoring → hashing →
  state-machine pipeline every 15 minutes using a synthetic low-risk
  request, filtered out of the real approval queue so it never gets in an
  approver's way.

See `docs/demo-video-script.md` for a full walkthrough of all of the above,
and `PROJECT_STATUS.md` for the underlying evidence behind each claim.

---

## Repo Structure

```
tegata/
├── ROADMAP.md              # 9 build phases, "done when" criteria per phase
├── PROJECT_STATUS.md       # current status & locked-in decisions — read this first each session
├── docs/
│   ├── tegata-concept.md   # full concept spec
│   ├── xano-setup.md       # ordered, checklist-driven guide to build Xano's Function Stack by hand
│   ├── xano-verification-worksheet.md  # exact input/output pairs (incl. pre-computed hashes) to verify each Xano endpoint against the Python reference
│   ├── doctavian-oauth-postman-setup.md  # step-by-step Postman OAuth 2.0 setup for Doctavian's Entra ID token (manual regen only — no working refresh_token flow)
│   ├── demo-video-script.md # beat-by-beat demo video script, timed to sponsors' 2-4 min requirement
│   ├── doctavian-samples/  # reference materials from Doctavian (sample data, real template, Elements/Expressions PDFs) — see its own README
│   ├── templates/          # generated .docx templates (e.g. tegata-warrant.docx)
│   ├── benchmarks.md       # (Phase 8) benchmark results
│   ├── testing.md          # (Phase 8) testing strategy & results
│   └── sponsor-requirements.md  # (Phase 8) per-sponsor submission checklist
├── apps/
│   ├── agent/               # Python — two-pass NLU + hard schema validation + risk/approval/state-machine/audit-log/Doctavian/Foxit reference logic
│   └── web/                 # Next.js/TypeScript — requester/approver/audit UI (Phase 6)
├── packages/
│   └── schema/               # shared data schema (used by agent & web)
├── scripts/
│   ├── phase-sync.sh         # syncs phase status ↔ GitHub Issues
│   └── verify_*.py           # real-network verification scripts (Doctavian, Foxit, NLU fallback, auto-expire) — see PROJECT_STATUS.md for what's confirmed working
├── tests/
│   └── e2e/                  # Playwright end-to-end (Phase 6)
└── .github/workflows/         # one CI workflow per phase
```

---

## Sponsor Credentials & Prerequisites

| Sponsor | Status |
|---|---|
| **Doctavian** | Credentials received. Integration built and **confirmed working end-to-end**: risk-scored documents generate with genuinely different approval clauses per tier, plus progressive-disclosure and dual-audience document generation (Phase 7), using Doctavian's own `{!fieldname}`/`{!$expression}`/`mdoc:paragraph` templating syntax (confirmed directly by their engineering team — see `docs/doctavian-samples/`). |
| **Foxit** | eSign API credentials received. Integration built and **confirmed working end-to-end**: envelope creation, real signature round-trip (including a genuinely rejected replay attempt), status polling, and signed-file download all verified against the live API. |
| **Xano** | Full RBAC, hash-chain audit verification, and the synthetic canary scheduled task are built and **verified against real cross-account tests** (not just read from the Function Stack) — see `PROJECT_STATUS.md`'s Phase 7 verification notes for exactly what was tested and how. `docs/xano-verification-worksheet.md` still has the original phase-by-phase reference cases if you want to re-verify from scratch. |

> See `PROJECT_STATUS.md` for the full, current, honest status of each integration — this table is a summary, not the source of truth.

---

## Running the Project

```bash
# Agent (Python) — 137 tests
cd apps/agent
pip install -r requirements.txt
pytest

# Real-network verification scripts (require your own API keys/tokens —
# see .env.example and each script's own docstring for setup)
cd ..
python scripts/verify_doctavian_template.py docs/templates/tegata-warrant.docx
python scripts/verify_foxit_envelope.py your-real-email@example.com
python scripts/verify_nlu_frontdoor.py "your test request text"
python scripts/verify_auto_expire_demo.py
python scripts/verify_audit_chain_endpoint.py <a real warrant_id>
python scripts/verify_stretch_document_routes.py   # needs npm run start already running, see below

# Web (Next.js). Defaults to a mock backend (no Xano needed); see
# apps/web/.env.local.example for switching to a real Xano workspace.
npm install          # from repo root — this is an npm workspace
cd apps/web
npm run build && npm run start   # production mode — what this project actually
                                  # runs on; `npm run dev` also works but hasn't
                                  # been the tested path recently
# http://localhost:3000

# Deploying — see docs/deployment.md for Vercel and Railway configs,
# both checked in and ready.

# E2E — real browser test, not just pytest. See
# scripts/verify_phase6_frontend.sh for the full verification flow
# (installs Playwright's Chromium, typechecks, runs pytest, then this).
npm run test:e2e     # from repo root
```

## Phase Status Sync

```bash
./scripts/phase-sync.sh <phase-number> start   # open/reopen issue, mark in-progress
./scripts/phase-sync.sh <phase-number> done    # close issue, mark done
./scripts/phase-sync.sh status                 # status table for all phases
```

---

## Build Status

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the current phase checklist and locked-in decisions.

## Full Roadmap

See [`ROADMAP.md`](ROADMAP.md) for per-phase scope, "done when" criteria, and test strategy.

---

## License

TBD (fill in per submission requirements — check whether the hackathon requires a specific open-source license for public repos).
