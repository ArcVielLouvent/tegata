#!/usr/bin/env bash
#
# Phase 6 verification script — runs the REAL frontend + REAL browser
# through Playwright, not just pytest.
#
# Two modes, using TWO SEPARATE Playwright configs and test suites
# (they exercise genuinely different UIs — xano mode requires login,
# mock mode doesn't — so one spec file can't cover both):
#
#   ./scripts/verify_phase6_frontend.sh
#       (default) tests/e2e/playwright.config.ts against apps/web's own
#       /api/mock/* backend — a TypeScript port of the exact same
#       reference algorithms apps/agent/src/tegata_agent/*.py already
#       has pytest coverage for (see apps/web/lib/referenceLogic.ts).
#       No Xano/Foxit/Doctavian credentials needed at all, deterministic,
#       safe for CI (nothing leaves the runner's own network).
#
#   ./scripts/verify_phase6_frontend.sh --mode=xano
#       tests/e2e/playwright.xano.config.ts against a REAL Xano
#       workspace. Requires NEXT_PUBLIC_XANO_API_BASE_URL and
#       NEXT_PUBLIC_XANO_AUTH_BASE_URL. Fully self-contained otherwise —
#       tests/e2e/xano/full-flow.spec.ts creates both a requester and an
#       approver test account automatically (the approver account is
#       created via a direct API call with role="approver", which
#       requires docs/xano-setup.md §9d's optional-role addition to
#       POST /auth/signup to be published — see that spec file's header
#       comment if this step fails).
#
# Usage:
#   chmod +x scripts/verify_phase6_frontend.sh
#   ./scripts/verify_phase6_frontend.sh
#   export NEXT_PUBLIC_XANO_API_BASE_URL=https://<workspace>.xano.io/api:<tegata-core-id>
#   export NEXT_PUBLIC_XANO_AUTH_BASE_URL=https://<workspace>.xano.io/api:<auth-id>
#   ./scripts/verify_phase6_frontend.sh --mode=xano
#
# Prerequisites: Node 20+, npm. Playwright's Chromium binary must be
# installed once (this script checks and installs it if missing —
# requires network access to Playwright's CDN, which most sandboxes
# restrict; run this locally or in CI, not inside a network-restricted
# container).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="mock"
for arg in "$@"; do
  case "$arg" in
    --mode=mock) MODE="mock" ;;
    --mode=xano) MODE="xano" ;;
    *)
      echo "Unknown argument: $arg (expected --mode=mock or --mode=xano)" >&2
      exit 2
      ;;
  esac
done

echo "=== Tegata Phase 6 frontend verification (mode: $MODE) ==="
echo

PLAYWRIGHT_CONFIG="tests/e2e/playwright.config.ts"

if [ "$MODE" = "xano" ]; then
  PLAYWRIGHT_CONFIG="tests/e2e/playwright.xano.config.ts"
  MISSING=0
  if [ -z "${NEXT_PUBLIC_XANO_API_BASE_URL:-}" ]; then
    echo "FAIL: --mode=xano requires NEXT_PUBLIC_XANO_API_BASE_URL (Tegata Core group's base URL)." >&2
    MISSING=1
  fi
  if [ -z "${NEXT_PUBLIC_XANO_AUTH_BASE_URL:-}" ]; then
    echo "FAIL: --mode=xano requires NEXT_PUBLIC_XANO_AUTH_BASE_URL (Authentication group's base URL)." >&2
    MISSING=1
  fi
  if [ "$MISSING" = "1" ]; then
    echo "  Find both under Xano's \"Connect this backend\" -> \"API URLs\" panel" >&2
    echo "  (not the Swagger Docs panel — see apps/web/.env.local.example)." >&2
    exit 1
  fi
  echo "Targeting real Xano — Tegata Core: $NEXT_PUBLIC_XANO_API_BASE_URL"
  echo "                       Authentication: $NEXT_PUBLIC_XANO_AUTH_BASE_URL"
  echo
fi

echo "--- Step 1: install dependencies (root workspace) ---"
npm install --no-audit --no-fund

echo
echo "--- Step 2: install Playwright's Chromium (skipped if already cached) ---"
npx playwright install chromium

echo
echo "--- Step 3: typecheck apps/web and tests/e2e ---"
(cd apps/web && npx tsc --noEmit)
(cd tests/e2e && npx tsc --noEmit)
echo "Typecheck OK."

echo
echo "--- Step 4: run the full Python regression (137+ tests) ---"
echo "  (Phase 6 depends on warrant_verification.py — a regression here"
echo "   would mean the frontend is demonstrating logic that no longer"
echo "   matches the reference implementation.)"
if [ -x "$REPO_ROOT/apps/agent/.venv/bin/pytest" ]; then
  "$REPO_ROOT/apps/agent/.venv/bin/pytest" -q --rootdir="$REPO_ROOT/apps/agent" "$REPO_ROOT/apps/agent"
else
  (cd apps/agent && python3 -m pytest -q)
fi

echo
echo "--- Step 5: run Playwright e2e against the real app + real browser ($PLAYWRIGHT_CONFIG) ---"
set +e
npx playwright test --config="$PLAYWRIGHT_CONFIG"
E2E_EXIT=$?
set -e

echo
if [ $E2E_EXIT -eq 0 ]; then
  echo "=== PASS ==="
  if [ "$MODE" = "xano" ]; then
    echo "Register -> request -> approver signs -> active -> replay rejected all"
    echo "reproduced successfully against the REAL Xano workspace."
  else
    echo "Happy path, the differing-approver-count wow moment, and the"
    echo "replay-rejection wow moment all reproduced successfully against"
    echo "the mock backend."
  fi
  exit 0
else
  echo "=== FAIL ==="
  if [ "$MODE" = "xano" ]; then
    echo "Common causes:"
    echo "  - The approver account's direct signup call failed: docs/xano-setup.md"
    echo "    §9d's optional-role addition to POST /auth/signup may not be published"
    echo "    yet in your workspace. See tests/e2e/xano/full-flow.spec.ts's header."
    echo "  - A 401/403 on Tegata Core calls: check the bearer token is actually"
    echo "    being sent — see apps/web/lib/apiClient.ts's request()."
    echo "  - Unexpected field shapes: apps/web/lib/apiClient.ts's normalizeWarrant()"
    echo "    is a best-effort adapter, not a confirmed-field-by-field mapping —"
    echo "    see its docstring."
  else
    echo "This is mock mode — a failure here means an actual regression"
    echo "in apps/web or lib/referenceLogic.ts. See the Playwright HTML"
    echo "report (npx playwright show-report) for the failing assertion"
    echo "and trace."
  fi
  exit 1
fi
