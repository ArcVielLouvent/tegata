#!/usr/bin/env bash
#
# Phase 6 verification script — runs the REAL frontend + REAL browser
# through Playwright, not just pytest. This is the "test beneran" for
# apps/web: it starts the actual Next.js server and drives an actual
# Chromium browser through the actual UI, exercising:
#   1. Happy path: submit a request -> see it scored -> approver signs
#      it -> it activates -> audit trail shows an intact hash chain.
#   2. The "different approver count for high vs low risk" wow moment.
#   3. Rejection path: replaying a signature on an already-active
#      warrant is rejected, VISIBLY in the UI (ROADMAP.md Phase 6
#      "done when" requirement) — not just rejected at the API level.
#
# Two modes:
#
#   ./scripts/verify_phase6_frontend.sh
#       (default) Runs against apps/web's own /api/mock/* backend — a
#       TypeScript port of the exact same reference algorithms
#       apps/agent/src/tegata_agent/*.py already has pytest coverage
#       for (see apps/web/lib/referenceLogic.ts). No Xano credentials
#       needed, deterministic, safe for CI.
#
#   ./scripts/verify_phase6_frontend.sh --mode=xano
#       Points the frontend at a REAL Xano workspace
#       (NEXT_PUBLIC_XANO_API_BASE_URL must be set). As of 2026-08-28
#       this requires the two endpoints specced in docs/xano-setup.md
#       §9a (POST /verify-signature) and §9b (POST /warrants) to exist
#       — neither is built in the live workspace yet, so this mode is
#       expected to fail with 404s until you build them. This is by
#       design: it's meant to tell you exactly that, not paper over it.
#
# Usage:
#   chmod +x scripts/verify_phase6_frontend.sh
#   ./scripts/verify_phase6_frontend.sh
#   ./scripts/verify_phase6_frontend.sh --mode=xano   # after building §9a/§9b
#
# Prerequisites: Node 20+, npm. Playwright's Chromium binary must be
# installed once (this script checks and installs it if missing —
# requires network access to Playwright's CDN, which most sandboxes
# restrict; run this locally, not inside a network-restricted
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

if [ "$MODE" = "xano" ]; then
  if [ -z "${NEXT_PUBLIC_XANO_API_BASE_URL:-}" ]; then
    echo "FAIL: --mode=xano requires NEXT_PUBLIC_XANO_API_BASE_URL to be set." >&2
    echo "  export NEXT_PUBLIC_XANO_API_BASE_URL=https://<your-workspace>.xano.io/api:<id>" >&2
    exit 1
  fi
  echo "Targeting real Xano at: $NEXT_PUBLIC_XANO_API_BASE_URL"
  echo "NOTE: this will fail unless docs/xano-setup.md §9a (POST /verify-signature)"
  echo "  and §9b (POST /warrants) have already been built in that workspace."
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
echo "--- Step 5: run Playwright e2e against the real app + real browser ---"
set +e
NEXT_PUBLIC_API_MODE="$MODE" \
NEXT_PUBLIC_XANO_API_BASE_URL="${NEXT_PUBLIC_XANO_API_BASE_URL:-}" \
  npx playwright test --config=tests/e2e/playwright.config.ts
E2E_EXIT=$?
set -e

echo
if [ $E2E_EXIT -eq 0 ]; then
  echo "=== PASS ==="
  echo "Happy path, the differing-approver-count wow moment, and the"
  echo "replay-rejection wow moment all reproduced successfully against"
  echo "a real browser driving the real UI (mode: $MODE)."
  exit 0
else
  echo "=== FAIL ==="
  if [ "$MODE" = "xano" ]; then
    echo "If failures mention 404s on /warrants or /verify-signature, that"
    echo "confirms docs/xano-setup.md §9a/§9b haven't been built yet in"
    echo "your Xano workspace — this is a known, documented gap, not a"
    echo "frontend bug. Build those two endpoints, then re-run."
  else
    echo "This is mock mode — a failure here means an actual regression"
    echo "in apps/web or lib/referenceLogic.ts. See the Playwright HTML"
    echo "report (npx playwright show-report) for the failing assertion"
    echo "and trace."
  fi
  exit 1
fi
