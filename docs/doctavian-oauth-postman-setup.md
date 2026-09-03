# Doctavian OAuth 2.0 — Postman Setup Instructions

Doctavian's API requires **both** an `x-api-key` header **and** a Microsoft
Entra ID OAuth 2.0 bearer token on every call. The bearer token cannot be
obtained through our own backend — Doctavian's OAuth client's
`redirect_uri` is hard-locked to `oauth.pstmn.io`, so it can only be
completed inside Postman itself. This doc is the exact, repeatable setup so
anyone on the team (or a judge re-running the project) can get a working
token in under a minute.

## One-time collection setup

In the target collection (or request) → **Authorization** tab:

| Field | Value |
|---|---|
| Auth Type | `OAuth 2.0` |
| Grant Type | `Authorization Code` (with PKCE) |
| Callback URL | `{{redirectUri}}` → `https://oauth.pstmn.io/v1/callback` |
| Auth URL | `{{authUrl}}` — Doctavian's Microsoft Entra ID authorize endpoint |
| Access Token URL | `{{accessTokenUrl}}` — `.../auth/microsoft/token` |
| Client ID | `{{clientId}}` — from Doctavian onboarding |
| Client Secret | *(leave blank — public client via PKCE; do not paste one unless Doctavian's docs explicitly give you one)* |
| Code Challenge Method | `S256` |
| Code Verifier | leave blank — auto-generated |
| Scope | `{{scope}}` — from Doctavian onboarding |
| Client Authentication | **Send as Basic Auth header** is *not* what's used here — leave on the default (**Send client credentials in body**), see "Why the token refresh error happens" below |

Save these as collection/environment variables (`redirectUri`, `authUrl`,
`accessTokenUrl`, `clientId`, `scope`) rather than hardcoding them into the
request, so every request in the collection shares one token.

## Getting a token

1. Open the **Authorization** tab on the collection (or on `Doctavian Demo`
   → Authorization, as in the current setup).
2. Click **Get New Access Token**.
3. Complete the Microsoft login in the popup (any Microsoft account works —
   Doctavian's Entra ID app isn't locked to a specific tenant).
4. Postman shows the retrieved token under **Current Token** — click **Use
   Token**.
5. Copy the token value into `.env` as `DOCTAVIAN_ACCESS_TOKEN` if you're
   running the project's own scripts (`verify_doctavian_template.py`, etc.)
   outside Postman.

The token is short-lived (observed ~1 hour; Doctavian's docs say requests
are rejected within ~2 minutes of expiry) — repeat steps 2–5 whenever it
expires. **Do this right before recording the demo video**, not the night
before.

## Why `refresh_token` doesn't apply here

Postman's **Auto-refresh Token** toggle (visible under **Current Token** in
the screenshot) tries to use the OAuth 2.0 `refresh_token` grant to renew
the token silently before each request, without a login popup. For this
Doctavian/Entra ID app, that attempt is what's failing:

```
AADSTS900144: The request body must contain the following parameter: 'client_id'
```

This is Microsoft's token endpoint rejecting the *refresh* call
specifically, not the original login. In practice this integration only
has a working **Authorization Code** exchange (the manual "Get New Access
Token" flow); a working `refresh_token` grant was never issued/confirmed
for this Entra ID app, and — since the redirect is locked to
`oauth.pstmn.io` — there's no way to build a custom automated refresh
outside Postman either way.

**Setup instruction: turn Auto-refresh Token OFF.** Leaving it on doesn't
break the initial token (that part already works — see the two `200`
responses in the Postman console), it only produces a confusing `400`
error later, right around the moment the token is about to expire —
exactly the kind of thing that can happen live on camera. Treat the token
as manually-regenerated-only:

- No automated refresh is built into the project, and none is planned —
  it isn't possible without a redirect target other than
  `oauth.pstmn.io`.
- `DOCTAVIAN_ACCESS_TOKEN` in `.env` must be refreshed by hand via the
  steps above whenever `DoctavianClient` starts returning
  `AUTHORIZATION_ERROR` / "Google token is invalid or expired" (Doctavian's
  own misleading wording for an expired Microsoft/Entra ID token).

## Quick troubleshooting

| Symptom | Cause |
|---|---|
| `AADSTS900144: ... 'client_id'` on a `POST .../auth/microsoft/token` that fires **without you clicking anything** | Auto-refresh Token firing on an expired/expiring token. Turn the toggle off; get a new token manually. |
| Same error right after clicking **Get New Access Token** | `clientId` variable is empty or not resolving — check the environment/collection variable, not the Authorization tab field itself (it just references `{{clientId}}`). |
| `AUTHORIZATION_ERROR: "Google token is invalid or expired"` from the actual API (not Postman) | Token in `.env`/`DOCTAVIAN_ACCESS_TOKEN` has expired — repeat the "Getting a token" steps and update `.env`. |
