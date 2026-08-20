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
│   ├── benchmarks.md       # (Phase 8) benchmark results
│   ├── testing.md          # (Phase 8) testing strategy & results
│   └── sponsor-requirements.md  # (Phase 8) per-sponsor submission checklist
├── apps/
│   ├── agent/               # Python — two-pass NLU + hard schema validation
│   └── web/                 # Next.js/TypeScript — requester/approver/audit UI
├── packages/
│   └── schema/               # shared data schema (used by agent & web)
├── scripts/
│   └── phase-sync.sh         # syncs phase status ↔ GitHub Issues
├── tests/
│   └── e2e/                  # Playwright end-to-end
└── .github/workflows/         # one CI workflow per phase
```

---

## Sponsor Credentials & Prerequisites

| Sponsor | How to get access | Status |
|---|---|---|
| **Xano** | Sign up via [go.xano.co/devpost-challenge](https://go.xano.co/devpost-challenge), use coupon code `M_Xano_PER_100_2608_1_DevpostHackathon` at checkout → 1 free month of the Essential Instance. Enable *direct workspace pushing* in Settings so the CLI/MCP can push directly. | Not yet registered |
| **Doctavian** | Email `hello@doctavian.com`, introduce yourself + explain the project needs their dynamic branching/looping document logic. They promise fast credential setup. | Not yet sent, pricing unconfirmed |
| **Foxit** | Basic PDF manipulation: use their open-source MCP server, no special credentials needed. **Foxit eSign API** (the most critical part for Tegata): email `theodore_castro@foxitsoftware.com` (the official rules page has it written as `.come` — likely a typo; try `.com` first, fall back to the exact address in the official rules if it bounces). | Not yet sent, pricing unconfirmed |

> These three steps are meant to start **once the coding phase begins**, not now — to avoid credentials sitting idle before they're actually used. Email Doctavian & Foxit early in that phase since sponsors typically need 1–2 business days to respond.

---

## Running the Project (will fill in as phases progress)

```bash
# Agent (Python)
cd apps/agent
pip install -r requirements.txt
pytest

# Web (Next.js)
cd apps/web
pnpm install
pnpm dev

# E2E
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