# Tegata — Demo Video Script

Every beat below has actually been reproduced and confirmed working in this
project's own testing (not aspirational) — see `PROJECT_STATUS.md` for the
underlying evidence of each claim if you want to double-check something
before recording. Segments marked **[CORE]** are the spine of the story and
shouldn't be cut. Segments marked **[DEPTH]** prove breadth beyond the core
flow — cut these first if you're over your time limit, in the order listed
(bottom of a DEPTH group = safest to cut).

Narration is in English (international hackathon audience). Read it as a
guide, not a script to recite word-for-word — sound like a person who built
this and is proud of it, not someone reading captions.

**Total estimated runtime if you keep everything: ~7-8 minutes.** A tight
cut keeping only [CORE] segments: ~3 minutes.

**Target length: 2-4 minutes.** Doctavian's and Xano's own challenge pages
both explicitly ask for a "2-4 min demo video" — that's the binding limit
for this project's target tracks, not the general Devpost "Video Demo"
field (which has no stated limit) or Perfect Corp's separate 1-3 min ask
(not one of our target sponsors). The [CORE]-only cut already lands right
in that window — add [DEPTH] segments only as far as ~4 minutes allows,
in the order listed (top of the list first).

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
   `refresh_token` flow for this integration (see
   `docs/doctavian-oauth-postman-setup.md`). Get a fresh token via
   Postman's "Get New Access Token" and update `DOCTAVIAN_ACCESS_TOKEN` in
   `.env` (restart `npm run start` after). Also turn **Auto-refresh
   Token** off in Postman — leaving it on doesn't affect the demo app
   itself, but it can throw a confusing `AADSTS900144` error mid-session
   if you're also using Postman on camera or in a second window.

---

## 1. The premise, stated once, on camera **[CORE]** — ~20s

Show the README or a title card with the core principle line:

> **"What the human signs is exactly what the machine executes. No hidden
> payload."**

**Say:** *"Tegata is a time-boxed access authorization system. Instead of
someone getting standing admin access forever, they request it, an AI helps
draft the request, a human reviews and signs a real document, and access is
automatically granted — then automatically revoked when it expires. No
manual cleanup, no forgotten permissions lying around."*

---

## 2. Request → NLU → risk scoring **[CORE]** — ~40s

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

## 3. The locked resource — deny **[CORE]** — ~30s

Switch to the browser tab already on `/resource/internal_wiki` as
**requester A** (or navigate there fresh).

**Say:** *"Before I go any further — here's the actual thing this warrant is
supposed to protect. Right now, I don't have access."*

Show the **🔒 Access denied** banner. Point out the subtitle text on the
page: *"every load ... asks Xano fresh, with your real token"* — this
isn't a client-side toggle, it's a server route independently re-checking
against Xano on every single request.

---

## 4. Approve and sign — real Doctavian + Foxit **[CORE]** — ~60s

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

## 5. The locked resource — grant **[CORE]** — ~20s

Back to the `/resource/internal_wiki` tab (still as requester A) — either
wait for its 10-second auto-poll or click **"Check again now."**

**Say:** *"Same URL, same page, nothing manually refreshed on my end — it
just picked up the state change on its own next check."*

Show the **✅ Access granted** banner with the warrant ID, real expiry
timestamp, and the confidential content underneath.

---

## 6. Anti-replay — the classic "wow" moment **[CORE]** — ~25s

Still as approver, on the now-active warrant's card, click the **"Replay
attempt (sign again)"** button.

**Say:** *"Someone tries to reuse this same signed envelope — maybe a
compromised session, maybe a bug somewhere upstream. Watch."*

Show the rejection message: *"Warrant '...' has already been used — replay
rejected."* — this is a real, tested check (`ReplayRejectedError`), not a
UI-only guard.

---

## 7. Auto-expiry — the loop closes itself **[CORE]** — ~15-30s

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

## 8. Tamper-proof audit trail **[DEPTH]** — ~45s

Click **"View audit trail →"** on the now-settled warrant.

1. Show the entries: `requested`, `scored`, `pending_approval`,
   `signed_and_activated` — each with its own hash, linked to the previous
   entry's hash. Banner reads **"Hash chain intact."**
2. Cut to the terminal: run
   `python scripts/verify_audit_chain_endpoint.py <warrant_id>` — show
   `PASS`.
3. **Say:** *"Now watch what happens if someone edits history directly in
   the database."*
4. Cut to Xano's Database tab, hand-edit one field on one `audit_log` row.
5. Re-run the same script — show `DISAGREEMENT` / `intact: false` with the
   exact broken row identified. **This was independently reproduced this
   week, including the exact broken-row index matching a second,
   independent Python recomputation of the same chain — it's not just
   Xano's own claim, it's cross-checked.**

---

## 9. Progressive disclosure + dual-audience documents **[DEPTH]** — ~40s

Split-screen or quick cuts between the saved PDFs
(`phase7-smoke-output/*.pdf`, regenerate first with
`scripts/verify_stretch_document_routes.py` if stale):

- `progressive_redacted.pdf` vs `progressive_full.pdf` — same warrant, the
  redacted copy visibly withholds the technical execution details (the
  literal grant command) until a first approver has actually signed.
- `dual_warrant.pdf` vs `dual_runbook.pdf` — same warrant, two genuinely
  different documents: one reads like a formal grant, the other like an
  on-call runbook with copy-pasteable commands and an explicit "don't
  manually extend this" warning.

**Say:** *"Same underlying data, generated into different documents for
different audiences and different trust levels — not just a template with
find-and-replace."*

---

## 10. Data isolation — RBAC that actually filters **[DEPTH]** — ~30s

Switch to **requester B**.

1. Show B's own "My requests" — empty or only B's own requests, never A's.
2. Try navigating to `/audit/<A's warrant id>` directly by URL — show the
   **"Couldn't load this audit trail"** error, not A's data.

**Say:** *"This isn't hidden by the UI — the API itself won't hand back
another user's data, whether you go through the app or call it directly."*

---

## 11. Extension requests **[DEPTH]** — ~25s

As requester A, on an active warrant nearing expiry, click **"Request
extension (expiring soon!)."** Show the pre-filled extension form
referencing the original warrant ID, submit it, show the new request card
labeled *"Extension of `<original warrant id>`."*

**Say:** *"An extension is its own brand-new request that needs its own
approval — the original grant is never silently modified."*

---

## 12. Synthetic canary — self-monitoring **[DEPTH, optional]** — ~20s

Cut to Xano's Task History for `canary_health_check`, showing repeated `OK`
runs every 15 minutes, then to the Approver page's collapsed **History**
section showing a `SYNTHETIC-CANARY` warrant that never cluttered the real
queue.

**Say:** *"The system tests its own scoring and hashing pipeline
automatically, every 15 minutes, using a synthetic low-risk request — and
it's filtered out of the real approval queue so it never gets in a real
approver's way."*

---

## 13. Close **[CORE]** — ~15s

**Say:** *"Every piece of this — scoring, documents, signature, audit trail,
and the access gate itself — checks itself against real, hard state every
time, not against what the UI last remembered. That's Tegata."*

---

## If something fails on camera

- **Foxit signing iframe slow to load**: normal, give it a few seconds —
  don't panic and refresh, that can drop the signing session.
- **Resource gateway still shows 🔒 right after signing**: wait for the
  10-second poll or click "Check again now" once — don't spam-click.
- **Wrong account showing in a tab**: pause, switch, resume — cutting this
  in editing is completely normal and expected for a hackathon submission.
