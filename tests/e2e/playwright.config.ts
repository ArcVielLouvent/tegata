import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Runs Phase 6's e2e tests against apps/web in NEXT_PUBLIC_API_MODE=mock —
 * deterministic, no Xano credentials needed. This is what ROADMAP.md's
 * Phase 6 "Tests" line means by "Playwright e2e for the happy path ...
 * and the rejection path." Real-Xano-mode e2e is a manual/local exercise
 * once docs/xano-setup.md §9a/§9b are actually built (see
 * scripts/verify_phase6_frontend.sh --mode=xano).
 */
export default defineConfig({
  testDir: __dirname,
  fullyParallel: false, // shared in-memory mock store — specs must not race each other
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    cwd: path.resolve(__dirname, "../../apps/web"),
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NEXT_PUBLIC_API_MODE: "mock" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
