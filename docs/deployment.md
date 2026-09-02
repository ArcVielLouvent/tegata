# Deployment: Vercel and Railway

Both configs are checked in and ready. The one real difference between them that
matters for this project: **Vercel runs each API route as a serverless function
with a timeout; Railway runs `next start` as one persistent process with no such
limit.** `POST /api/nlu/parse`'s LLM fallback chain (Gemini -> Groq ->
OpenRouter, see `llmClient.ts`) can take up to ~45s in the worst case if the
first two providers both time out — that's already past Vercel's *default*
function timeout (10s on Hobby, 15s otherwise) even before `export const
maxDuration = 60` (already added to that route) raises the ceiling. Whether
that 60s actually applies depends on your Vercel plan:

- **Hobby**: max function duration is capped at 60s (Fluid Compute) — the
  route's own `maxDuration = 60` should be honored, but confirm in the Vercel
  dashboard after first deploy; Hobby plans have changed this limit before.
- **Pro/Enterprise**: 60s is comfortably within plan limits.
- **Railway**: no relevant limit either way — this whole paragraph is a
  non-issue there.

If NLU parsing timing out in production turns out to be a real problem during
the demo, Railway is the safer target for that specific route regardless of
which platform hosts the rest of the app.

## Vercel

1. Import the repo in the Vercel dashboard.
2. **Project Settings -> General -> Root Directory: `apps/web`** — required;
   this is an npm workspaces monorepo (`@tegata/schema` is a workspace
   package `apps/web` depends on), and `apps/web/vercel.json`'s
   `installCommand`/`buildCommand` (`cd ../.. && npm install` /
   `npm run build --workspace=apps/web`) assume Root Directory is set this
   way so they can `cd` back up to install from the monorepo root.
3. Add every var from `.env.example` (repo root) as a Vercel environment
   variable — `NEXT_PUBLIC_*` ones need to be set for Production
   **and** Preview if you want preview deploys to work against Xano.
4. Deploy. Vercel auto-detects Next.js from `apps/web/vercel.json`'s
   `"framework": "nextjs"`.

## Railway

1. New Project -> Deploy from GitHub repo. **Leave Root Directory as the
   repo root** (not `apps/web`) — `railway.json` (repo root) already targets
   `apps/web` explicitly via the `--workspace` flag in both its build and
   start commands, so Railway needs to run `npm install` from the root where
   the workspace's `package-lock.json` actually lives.
2. Add the same `.env.example` variables as Railway environment variables
   (Settings -> Variables).
3. Railway's Nixpacks builder picks up `railway.json` automatically; no
   extra config needed beyond the environment variables.
4. Railway assigns a domain automatically (or add a custom one under
   Settings -> Networking) — no port config needed, `next start -p 3000`
   already binds correctly and Railway detects it.

## Either platform

- CORS: confirm Xano's workspace allows the deployed domain as an origin
  (Xano's own CORS settings, not something either platform configures) —
  `apiClient.ts`'s own error handling already flags this as one of the two
  likely causes of a request that never gets a response at all, so it's
  worth checking proactively for a new production domain rather than
  waiting to hit it.
- The Foxit eSign signing URL is an embedded iframe (`foxit-signing-url`)
  pointed at Foxit's own domain — no extra config needed on either
  platform for that to keep working, since it's the browser loading Foxit
  directly, not a server-to-server call from Vercel/Railway.
