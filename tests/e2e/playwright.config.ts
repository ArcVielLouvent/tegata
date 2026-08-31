import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Runs Phase 6's e2e tests against apps/web in NEXT_PUBLIC_API_MODE=mock —
 * deterministic, no Xano credentials needed. This is what ROADMAP.md's
 * Phase 6 "Tests" line means by "Playwright e2e for the happy path ...
 * and the rejection path." Real-Xano-mode e2e is a manual/local exercise
 * once docs/xano-setup.md §9a/§9b are actually built (see
 * scripts/verify_phase6_frontend.sh --mode=xano).
 *
 * webServer intentionally runs a PRODUCTION build (`next build && next
 * start`), not `next dev`. In dev mode Next.js compiles each route
 * on-demand on its first request, which raced against Playwright's
 * assertion timeouts on GitHub Actions runners (slower + colder than a
 * local machine) and caused flaky "element not found" / stuck-state
 * failures on `/approver`, `/audit/[id]`, and the `/api/mock/*sign`
 * route the first time each was hit. Production build precompiles
 * every route up front, so first-hit latency is consistently <150ms
 * instead of racing a multi-second on-demand compile. Do not change
 * this back to `next dev` without re-confirming CI stability.
 */
export default defineConfig({
  testDir: __dirname,
  // tests/e2e/xano/full-flow.spec.ts must NEVER run under this config:
  // this webServer only sets NEXT_PUBLIC_API_MODE=mock, so that spec's
  // direct POST to NEXT_PUBLIC_XANO_AUTH_BASE_URL + /auth/signup ends up
  // hitting this Playwright run's own baseURL (http://localhost:3000,
  // the mock server) instead — which has no /auth/signup route at all,
  // hence a 404 that looks like a real Xano contract problem but isn't.
  // Confirmed 2026-08-29 from a real CI run: `testDir: __dirname` alone
  // picks up everything under tests/e2e/ recursively, xano/ included —
  // testIgnore is required, not optional. Real-Xano e2e only ever runs
  // via playwright.xano.config.ts (testDir scoped to xano/ specifically,
  // and it fails fast if the required Xano env vars are missing rather
  // than silently hitting the wrong server).
  testIgnore: ["xano/**"],
  fullyParallel: false, // shared in-memory mock store — specs must not race each other
  workers: 1,
  retries: process.env.CI ? 1 : 0, // safety margin for CI runner variance, not a substitute for the fix above
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  expect: {
    timeout: 8_000, // slightly above the 5s default — CI runners are slower than a local machine
  },
  webServer: {
    command: "npm run build && npm run start",
    cwd: path.resolve(__dirname, "../../apps/web"),
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000, // build (~40s measured) + server start, with headroom for a slow CI runner
    env: { NEXT_PUBLIC_API_MODE: "mock" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
