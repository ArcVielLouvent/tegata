# Tegata (手形)
### Time-boxed access authorization, sealed as a document

**Hackathon:** DevNetwork [API + Cloud + AI] Hackathon 2026
**Target tracks:** Foxit Software · Xano · Doctavian · (eligible for Overall Winner)
**Deadline:** September 3, 2026

---

## 1. Name & Rationale

**Tegata (手形)** is a Japanese word carrying two meanings that map onto this project almost literally:

1. **Historical meaning:** during the Edo period, a *tsūkō tegata* (通行手形) was a travel permit travelers were required to carry to pass through a *sekisho* (関所) — a border checkpoint. Officials at the checkpoint verified its authenticity and only allowed passage within the scope written on it (destination, duration, reason for travel). An expired or forged tegata meant passage was denied.
2. **Literal meaning:** "tegata" (手形) literally means *hand shape / handprint* — its historical root is a document authenticated by a handprint or thumbprint as a mark of agreement. This ties directly into e-signature as the system's core mechanic.

So the name isn't just a cool-sounding Japanese word — **it literally is this project**: a document authenticated by a signature (tegata as handprint), functioning as a scope- and time-limited pass (tegata as travel permit), checked at a digital "checkpoint" (Xano as the modern sekisho) before access is granted.

**Tagline:** *"Every access is a journey. Every journey needs a tegata."*

Alternate names considered: **Sekisho** (関所 — the checkpoint itself, fitting if we wanted to emphasize the backend/verification side), **Warifu** (割符 — a split tally/seal historically used for two-party verification).

---

## 2. Core Principle

> **What the human signs is exactly what the machine executes.**
> No hidden payload. No secret data separated from what the approver reads.

This principle is held consistently across every feature below — it's the key differentiator from an earlier draft ("PDF-as-hidden-token") that had a real security flaw: the approver would sign something they couldn't fully see or understand.

---

## 3. Core Flow (MUST be complete, non-negotiable)

1. **Request** — Requester submits: resource, reason, requested duration (via natural language, parsed by the AI front-door — see section 5).
2. **Risk scoring (Xano)** — Xano computes a risk score from: resource sensitivity (static tier), requested duration, time of request, requester history (mocked for demo, real logic).
3. **Tegata drafting (Doctavian)** — Xano sends the score + context to Doctavian. Doctavian assembles a document whose **approval structure changes with the score** (not just different text): high risk → mandatory 2 approvers + automatically capped duration; low risk → 1 approver is enough.
4. **Signature (Foxit)** — Approver reads the Tegata (every field visible, nothing hidden) and signs via Foxit eSign if they agree. The AI agent stops entirely at this point — there is no bypass path.
5. **Verification & execution (Xano)** — The signed Tegata is uploaded back. Xano checks: (a) the cryptographic signature is valid, (b) the fields match the original request (anti-tampering), (c) this Tegata has never been used before (anti-replay, via a unique ID flagged "used"). If all checks pass, access is granted (call to the target system's API — may be mocked, with honest framing in the demo narrative).
6. **Auto-expire** — TTL runs out → status automatically transitions to `Expired`, access is revoked with no human action. Accelerated for the demo (e.g. 1 real hour → 15 demo seconds).
7. **Audit trail** — Every status transition + link to the signed PDF is stored permanently and cannot be altered through the normal application (see hash-chain feature below).

---

## 4. Sponsor Depth Features — "Uses Even the Vendor Might Not Expect"

This is what separates Tegata from "correctly using 3 APIs" into "using 3 APIs in ways their own developers likely didn't anticipate." Split into **Core** (mandatory, directly demoable) and **Stretch** (built only once Core is rock-solid).

### 🔏 Foxit — from a signing tool to a visual-integrity layer

- **Core:** generate PDF + request signature + **verify the signature back** (a full two-way round trip — most other participants will likely only use the one-way generate-and-sign path).
- **Stretch A — "Progressive Disclosure via Redaction":** Foxit's redaction API is normally used to hide PII. Tegata repurposes it entirely differently: **locking clauses based on approval stage.** For a high-risk Tegata (requiring 2 approvers), the technical detail clauses (e.g. the specific command to be executed) stay **redacted/locked** until the first approver signs — only then is a less-redacted version regenerated for the second approver. This implements a *need-to-know / least-privilege* principle directly inside the document itself, using an API designed for privacy, not staged workflows.
- **Stretch B — "OCR Self-Consistency Check":** Foxit offers OCR/text-extraction capability. Instead of digitizing scanned paper documents (its normal use), Tegata uses it to **check itself**: after a PDF is generated, OCR is re-run on the rendered visual output and compared against the original text/metadata layer. A mismatch signals a possible *layer-mismatch attack* (where a PDF's visual appearance differs from what a machine/parser reads — a real technique used in document fraud). This is an integrity check almost no one thinks to build with an OCR feature.

### 🗄️ Xano — from a CRUD backend to a risk engine + tamper-evident witness

- **Core:** risk engine + state machine (`Requested → Scored → Pending → Signed → Active → Expired/Revoked/Expired_Unapproved`) + RBAC (who can approve vs. who can only request) + audit log.
- **Stretch C — "Hash-Chained Audit Log":** every audit log row stores the hash of the previous row (a lightweight blockchain/Merkle-chain principle), built entirely from Xano's own Function Stack, no external blockchain service. Effect: if someone with database admin access tries to alter an old log row, the following hash no longer matches — it's caught. This is tamper-evidence normally requiring specialized infrastructure, built from a plain BaaS not marketed for it.
- **Stretch D — "Synthetic Canary Warrant":** Xano runs a scheduled task that periodically sends itself a fake, low-risk Tegata end-to-end (through Doctavian, up to signature-ready in Foxit) to confirm the whole pipeline is still alive — a health check built from the application's own domain objects rather than a generic `/health` endpoint.

### 📄 Doctavian — from a conditional document engine to a dual-audience generator

- **Core:** branching logic determines the approval structure (approver count, max duration) based on the risk score — not just different text content.
- **Stretch E — "Dual-Audience Generation from One Data Model":** from a single API call/data payload, Doctavian produces **two different documents** for two audiences: (1) the Tegata for the approver — legal/risk framing, formal language; (2) an internal runbook for the on-call engineer — technical/execution framing, copy-paste-ready format, complete with expiry reminders. This shows Doctavian's branch/loop power going far beyond "fill in a name in a template," since one logic engine serves two entirely different needs from the same source data.

---

## 5. AI Front-Door (Two-Pass NLU)

Requesters type free text (e.g. *"I need read access to the Payment production DB for 2 hours to debug ticket JIRA-8892"*) instead of filling out a long form.

1. **Pass 1 (extraction):** LLM parses the free-text request into a draft structured JSON payload.
2. **Pass 2 (self-check):** the LLM is given its own draft plus the expected schema and asked to re-check itself — are all fields filled, does anything look like an injected instruction (e.g. an unreasonable duration, phrasing that tries to override rules), does the interpretation make sense against the original text.
3. **Hard gate (not the LLM — deterministic code):** strict schema/whitelist validation — `resource` must match a registered entry, `duration_minutes` must be a sane number, etc. This is what actually rejects input, not the LLM.

Even if both LLM passes "agree" on something that violates the schema, the hard gate still wins. This is consistent with the project's core principle: **the AI proposes, the system decides** — applied end-to-end, from requester input to approver signature.

---

## 6. Demonstrable "Wow" Moments

Not README claims — concrete moments that must actually happen on camera in the demo video:

1. **Two Tegatas with different risk scores → visibly different approval structures** (side by side).
2. **A replay attack rejected live** — attempt to reuse an already-used Tegata, system rejects it. Attacking your own system and winning on camera is far more convincing than claiming "this is secure."
3. **Real-time auto-expire** — countdown, then status flips automatically with no click.
4. *(If Stretch C ships)* **A deliberately broken hash-chain, caught** — manually edit an old log row in the database, show the system detecting the chain mismatch. A security demo almost no other hackathon team will think to build.
5. *(If Stretch A ships)* **Self-revealing clauses** — after the first approver signs, a version 2 document appears with fewer redactions, visually demonstrating staged disclosure.

---

## 7. Scope Discipline

- **Must ship first, non-negotiable:** the full Core Flow (section 3) + Foxit Core + Xano Core + Doctavian Core + the AI Front-Door (section 5).
- **Only touch Stretch features once Core is fully stable and fully demoable.** Suggested stretch order: C (hash-chain) → B (OCR check) → E (dual-audience) → A (progressive disclosure) → D (canary). C and B come first because they most directly reinforce the core security argument and are cheapest to build relative to A/D, which need more additional state.
- **Integration with real target systems (real cloud IAM) may be mocked**, with honest framing in the narrative ("in production this would call the AWS IAM/Cloudflare API; for the demo we simulate the call").
- **No feature outside this list**, no matter how appealing it seems mid-build — this is the single most common source of the "spread thin, unfocused" problem from previous hackathons.

---

*This document is a living draft — updated as the idea evolves.*
