# Setup Instructions

Everything below gets you from a fresh clone to a running demo. If you're a
judge/reviewer rather than the team, skip straight to "Quick start (mock
mode)" — it needs no credentials at all.

---

## Quick start (mock mode — no credentials needed)

```bash
npm install                    # from repo root — this is an npm workspace
cd apps/web
npm run build && npm run start
# http://localhost:3000
```

This talks to an in-memory, deterministic port of the exact same reference
algorithms used everywhere else in this project (`lib/referenceLogic.ts`) —
same risk scoring, same state machine, same audit hash chain — just without
a real Xano/Doctavian/Foxit backend behind it. Good enough to see the whole
UI and flow; not good enough to see the real-integration proof points (real
signed documents, real hash-chain verification against a live Xano
endpoint, the resource gateway's real Xano round-trip).

---

## Full setup (real Xano + Doctavian + Foxit)

### 1. Environment files

Two separate `.env` files exist because the Python agent (`apps/agent`) and
the Next.js app (`apps/web`) each load their own:

```bash
cp .env.example .env                              # apps/agent + root scripts
cp apps/web/.env.local.example apps/web/.env.local # apps/web
```

Both files need the *same* Doctavian/Foxit/LLM credential values — see each
file's own inline comments for exactly which var goes where.

### 2. Xano

1. Base URL: Xano dashboard → "Connect this backend" → API URLs (**not**
   the Swagger Docs panel — that's documentation, not a callable URL).
   There are two separate API groups: **Tegata Core** (the main API) and
   **Authentication** (signup/login) — each has its own base URL, both go
   into `apps/web/.env.local` (`NEXT_PUBLIC_XANO_API_BASE_URL` and
   `NEXT_PUBLIC_XANO_AUTH_BASE_URL` respectively).
2. Confirm `resource_tiers` has all 6 rows (`db_payment_prod`,
   `db_payment_staging`, `db_analytics_prod`, `server_web_prod`,
   `server_web_staging`, `internal_wiki`) — this table has gone empty
   before and silently broken scoring when it did. See
   `apps/agent/src/tegata_agent/risk_engine.py`'s own comment for the
   exact sensitivity values each row needs.
3. Create at least one `approver` (or `security_admin`) account: register
   normally through the app's own `/login` page (this always creates a
   `requester`), then manually change that row's `role` field in Xano's
   Database tab — the app's own signup form can't self-assign a
   privileged role, by design.

### 3. Doctavian — token renewal

Doctavian's OAuth token is short-lived (~1hr observed) and
**refresh_token does not work for this integration** — reproduced directly,
not assumed. See `docs/doctavian-oauth-postman-setup.md` for the full
Postman setup, exact renewal steps, and troubleshooting table.

**On Vercel/Railway specifically:** updating the env var in either
platform's dashboard and letting it restart the running instance takes
well under a minute — this is not a full CI/CD redeploy, so "renew every
hour" is not the operational burden it might sound like. Renew right
before recording the demo and right before any live judging session, not
on a fixed schedule.

### 4. Foxit

eSign API credentials (`client_id`/`client_secret`) — from your Foxit
dashboard. `FOXIT_ESIGN_API_BASE_URL` should already be correct
(`https://na1.fusion.foxit.com/esign/api`) unless Foxit tells you
otherwise. Leave `FOXIT_PDF_SERVICES_*` blank initially — it falls back to
the eSign credentials automatically (see `foxitPdfServicesClient.ts`'s own
comment on why that's a reasonable default, not a guess pretending to be
one).

### 5. LLM keys (NLU front-door)

At least one of `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` —
the fallback chain skips any provider left blank. All three configured
makes the demo more resilient to any single provider's rate limit during a
live session.

### 6. Run it

```bash
npm install
cd apps/web
npm run build && npm run start
```

Set `apps/web/.env.local`'s `NEXT_PUBLIC_API_MODE=xano` to actually talk to
the real backend (defaults to `mock` otherwise).

### 7. Deploying

See `docs/deployment.md` for Vercel and Railway configs (both checked in
and ready) — including a specific note on the NLU route's serverless
timeout considerations on Vercel.

---

## Verifying it's actually working, not just running

Every `scripts/verify_*.py` script exists to answer "is this integration
actually real, or does it just look plausible" — run the ones relevant to
what you changed before trusting it:

```bash
python scripts/verify_doctavian_template.py docs/templates/tegata-warrant.docx
python scripts/verify_foxit_envelope.py your-real-email@example.com
python scripts/verify_nlu_frontdoor.py "your test request text"
python scripts/verify_auto_expire_demo.py
python scripts/verify_audit_chain_endpoint.py <a real warrant_id>
python scripts/verify_stretch_document_routes.py   # needs npm run start already running
```

See `PROJECT_STATUS.md` for what each one actually proved, and when.
