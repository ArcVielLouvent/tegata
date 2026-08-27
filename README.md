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
     [Xano]  → compute risk score → drive state machine
        │
        ▼
  [Doctavian]  → assemble document, approval structure changes with score
        │
        ▼
   [Foxit eSign]  → human reads & signs (agent stops entirely here)
        │
        ▼
     [Xano]  → verify signature + anti-replay → access active
        │
        ▼
   Auto-expire (TTL) → permanent audit trail
```

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
| **Doctavian** | Credentials received. Integration built and **confirmed working end-to-end** (Phase 2): risk-scored documents generate with genuinely different approval clauses per tier, using Doctavian's own `{!fieldname}`/`{!$expression}`/`mdoc:paragraph` templating syntax (confirmed directly by their engineering team — see `docs/doctavian-samples/`). |
| **Foxit** | eSign API credentials received. Integration built and **confirmed working end-to-end** (Phase 3/4): envelope creation, real signature round-trip, status polling, and signed-file download all verified against the live API. |
| **Xano** | Registered, workspace built (first pass, via Xano's own AI agent — see `PROJECT_STATUS.md`'s "Xano setup" section): tables, Function Stack functions, endpoints, RBAC, and the scheduled auto-expire task are all in place. **Verification against the Python reference is the current open item** — see `docs/xano-verification-worksheet.md` for the exact cases to check. |

> See `PROJECT_STATUS.md` for the full, current, honest status of each integration — this table is a summary, not the source of truth.

---

## Running the Project

```bash
# Agent (Python) — 120 tests as of Phase 5
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

# Web (Next.js) — Phase 6, not yet built
cd apps/web
pnpm install
pnpm dev

# E2E — Phase 6
pnpm playwright test
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
