# Tegata — Demo Video Script

Every beat below has actually been reproduced and confirmed working in this
project's own testing (not aspirational) — see `PROJECT_STATUS.md` for the
underlying evidence of each claim if you want to double-check something
before recording.

**Hard time budget: 3–4 minutes.** Confirmed directly from the hackathon
page (api-cloud-ai-hackathon-2026.devpost.com): Doctavian's track says
*"Demo video (2–4 min)"*, Xano's track says *"2–4 minute demo"* — both
sponsor tracks you're targeting state this explicitly, so 4 minutes is a
real ceiling, not a suggestion. (Perfect Corp's separate track asks for
1–3 min instead — not one of your target sponsors, so don't let that
shorter number pull your target down; 2–4 min is the one that applies.)

Segments marked **[CORE]** get their full time on screen — this is the
spine of the story. Segments marked **[CUTAWAY]** get **3–5 seconds each**,
narrated over quick screen flashes while you talk through them — enough to
prove breadth exists without spending the runway explaining each one in
full. Do not narrate a CUTAWAY at CORE-segment length; that's how a 3-minute
video becomes an 8-minute one.

Narration is in English (international hackathon audience). Read it as a
guide, not a script to recite word-for-word — sound like a person who built
this and is proud of it, not someone reading captions.

**Target breakdown to land inside 4:00 total:**
- CORE segments (1–7, 13): ~2:45
- CUTAWAY segments (8–12), ~15–20s combined: ~0:20–0:30 total, not per item
- Buffer for transitions/breathing room: ~0:30

If you're still over after one pass, cut CUTAWAY items from the bottom of
the list first (12 → 11 → 10 → 9 → 8), not CORE segments.

---

## Before you hit record

1. **Wipe the database** (see the cleanup order from earlier in this
   conversation: `audit_log` → `warrants` → `requests`, keep `user` and
   `resource_tiers`) — the current data has SYNTHETIC-CANARY rows, expired
   test warrants, and messy history mixed in. A clean recording needs a
   clean start.
2. Confirm `resource_tiers` still has all 6 rows (it was accidentally empty
   once already this project — see PROJECT_STATUS.md).
3. Create exactly 3 accounts fresh: `req-a@tegata.com` (requester),
   `req-b@tegata.com` (requester), `approver@tegata.com` (role set to
   `approver` manually in Xano's Database tab).
4. `cd apps/web && npm run build && npm run start` — production mode, and
   **rebuild** if you've pulled any code since your last build (stale builds
   caused several of the "bugs" found during testing this week that weren't
   really bugs).
5. Have 3 browser windows/profiles ready (or 3 separate browsers) logged in
   as A, B, and approver respectively, so switching accounts on camera is
   instant, not a live login-typing moment.
6. Have `scripts/verify_audit_chain_endpoint.py` ready in a terminal, env
   vars pre-exported, so the tamper-detection segment is one command, not a
   typing session.
7. **Regenerate the Doctavian access token manually, right before you
   record** — it's short-lived (~1hr) and there is no working
   `refresh_token` flow for this integration — see
   `docs/doctavian-oauth-postman-setup.md` for the exact Postman steps and
   why the auto-refresh fails, or `docs/setup-instructions.md` for the
   full environment setup. Get a fresh token via Postman's "Get New
   Access Token" and update `DOCTAVIAN_ACCESS_TOKEN` in both `.env` and
   `apps/web/.env.local` (restart `npm run start` after — env vars aren't
   hot-reloaded). Leave Postman's "Auto-refresh Token" toggle off for the
   recording session — it doesn't affect the demo app itself, but it can
   throw a confusing `AADSTS900144` error in a visible Postman window if
   you're also showing Postman on camera.

---

## 1. The premise, stated once, on camera **[CORE]** — ~15s

Show the README or a title card with the core principle line:

> **"What the human signs is exactly what the machine executes. No hidden
> payload."**

**Say:** *"Tegata is a time-boxed access authorization system. Instead of
someone getting standing admin access forever, they request it, an AI helps
draft the request, a human reviews and signs a real document, and access is
automatically granted — then automatically revoked when it expires. No
manual cleanup, no forgotten permissions lying around."*

---

## 2. Request → NLU → risk scoring **[CORE]** — ~30s

As **requester A**, on the request page:

1. Type a free-text description into the NLU box, e.g. *"I need to fix a bug
   on the internal wiki, ticket JIRA-123, should take about 15 minutes."*
2. Click **"Fill form from description"** — watch the form auto-populate
   (resource, reason, duration).
3. **Say:** *"This goes through a two-pass LLM step — extraction, then a
   self-check pass — but the LLM never has the final say. It only proposes.
   What actually decides is hard schema validation underneath, so a
   hallucinated or malformed field gets rejected before it ever reaches the
   database."*
4. Review the pre-filled form (don't just submit blind — show you're
   reviewing it), then **Submit request**.
5. Card appears: risk tier badge (low, for `internal_wiki`), status
   `PENDING_APPROVAL`.

---

## 3. The locked resource — deny **[CORE]** — ~20s

Switch to the browser tab already on `/resource/internal_wiki` as
**requester A** (or navigate there fresh).

**Say:** *"Before I go any further — here's the actual thing this warrant is
supposed to protect. Right now, I don't have access."*

Show the **🔒 Access denied** banner. Point out the subtitle text on the
page: *"every load ... asks Xano fresh, with your real token"* — this
isn't a client-side toggle, it's a server route independently re-checking
against Xano on every single request.

---

## 4. Approve and sign — real Doctavian + Foxit **[CORE]** — ~50s

Switch to **approver** account, Approver page.

1. Point out the request in "Needs your action" — risk tier, requester
   email, ticket ref all visible.
2. Click **"Prepare & send for e-signature."**
3. **Say:** *"This calls Doctavian to generate the actual grant document —
   and the clauses in that document genuinely change based on risk tier, not
   just a cosmetic label."* (Optionally flash the two saved PDFs from
   `phase7-smoke-output/` here as a quick cutaway if you have them handy —
   see segment 9.)
4. The Foxit signing iframe loads — **actually sign it** (this step must be
   a real human action on camera, not staged — that's the whole point of
   the project).
5. Click **"I've signed — confirm."**
6. Status flips to `ACTIVE`, signature count `1/1`.

---

## 5. The locked resource — grant **[CORE]** — ~15s

Back to the `/resource/internal_wiki` tab (still as requester A) — either
wait for its 10-second auto-poll or click **"Check again now."**

**Say:** *"Same URL, same page, nothing manually refreshed on my end — it
just picked up the state change on its own next check."*

Show the **✅ Access granted** banner with the warrant ID, real expiry
timestamp, and the confidential content underneath.

---

## 6. Anti-replay — the classic "wow" moment **[CORE]** — ~20s

Still as approver, on the now-active warrant's card, click the **"Replay
attempt (sign again)"** button.

**Say:** *"Someone tries to reuse this same signed envelope — maybe a
compromised session, maybe a bug somewhere upstream. Watch."*

Show the rejection message: *"Warrant '...' has already been used — replay
rejected."* — this is a real, tested check (`ReplayRejectedError`), not a
UI-only guard.

---

## 7. Auto-expiry — the loop closes itself **[CORE]** — ~15s

**Say:** *"And when the approved window runs out, nothing has to happen
manually — no one has to remember to revoke this."*

If your demo warrant has a short duration (a minute or two), you can
actually wait on camera and let `/resource/internal_wiki` flip back to
🔒 **Access denied** live. If not, cut to a pre-recorded clip of this
happening (it was reproduced during testing — see the resource-gateway
verification screenshots earlier in this project's history), or show the
warrant list showing `EXPIRED` status next to the same warrant ID you just
signed.

---

## 8–12. Depth, as fast cutaways **[CUTAWAY]** — ~25s combined

Pre-record or have ready as clips/screenshots so you're not live-navigating
during this block — cut rapidly between them while one continuous narration
line carries across all five:

**Say, over the cuts:** *"And it goes deeper than the happy path — the
audit trail is hash-chained and independently verified, tampering with a
stored row gets caught automatically; documents progressively disclose
technical details only after a signature exists; the same warrant generates
a formal grant doc and a separate operator runbook; one user's data is
structurally invisible to another, not just hidden by the UI; extending
access creates a brand-new request needing its own approval; and the whole
scoring pipeline health-checks itself every 15 minutes without ever
cluttering a real approver's queue."*

Flash (≤3–4s each, no need to fully read any of them on screen):
1. Audit trail page → terminal running
   `verify_audit_chain_endpoint.py` → `PASS`, then a hand-edited row →
   `DISAGREEMENT` with the exact broken row named.
2. `progressive_redacted.pdf` vs `progressive_full.pdf` side by side.
3. `dual_warrant.pdf` vs `dual_runbook.pdf` side by side.
4. Requester B's "My requests" (empty/own-only) or the `/audit/<A's id>`
   "Couldn't load this audit trail" error.
5. An extension request card labeled *"Extension of `<original warrant
   id>`."*
6. Xano's Task History for `canary_health_check` showing repeated `OK`
   runs, filtered out of the real Approver queue.

If you're tight on time, this whole block can shrink further by dropping
individual flashes (keep 1 and 2 first — audit tamper-detection and
progressive disclosure are the strongest of the six) rather than cutting
it entirely; even 2–3 flashes with the narration still lands the breadth
claim.

---

## 13. Close **[CORE]** — ~10s

**Say:** *"Every piece of this checks itself against real, hard state every
time, not against what the UI last remembered. That's Tegata."*

---

## If something fails on camera

- **Foxit signing iframe slow to load**: normal, give it a few seconds —
  don't panic and refresh, that can drop the signing session.
- **Resource gateway still shows 🔒 right after signing**: wait for the
  10-second poll or click "Check again now" once — don't spam-click.
- **Wrong account showing in a tab**: pause, switch, resume — cutting this
  in editing is completely normal and expected for a hackathon submission.
