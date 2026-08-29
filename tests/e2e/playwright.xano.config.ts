import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Runs tests/e2e/xano/*.spec.ts against a real Xano workspace — NOT the
 * mock backend. Separate from playwright.config.ts (mock mode) because:
 *   - it needs NEXT_PUBLIC_API_MODE=xano + the real Xano base URLs
 *   - it hits a real network, so needs more generous timeouts
 *
 * Fully self-contained otherwise — see tests/e2e/xano/full-flow.spec.ts's
 * header comment for how it creates both a requester and an approver
 * account automatically, with no manual Xano setup and no persistent
 * test account.
 *
 * Required env vars (fails fast below if missing):
 *   NEXT_PUBLIC_XANO_API_BASE_URL   — Tegata Core group's base URL
 *   NEXT_PUBLIC_XANO_AUTH_BASE_URL  — Authentication group's base URL
 *
 * Usage: npx playwright test --config=tests/e2e/playwright.xano.config.ts
 * (scripts/verify_phase6_frontend.sh --mode=xano does this for you,
 * including checking these env vars up front with a clearer message.)
 */

const REQUIRED_ENV = ["NEXT_PUBLIC_XANO_API_BASE_URL", "NEXT_PUBLIC_XANO_AUTH_BASE_URL"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `playwright.xano.config.ts: missing required env var(s): ${missing.join(", ")}. ` +
      "See apps/web/.env.local.example and this file's header comment."
  );
}

export default defineConfig({
  testDir: path.resolve(__dirname, "xano"),
  fullyParallel: false,
  workers: 1,
  retries: 0, // a retry here would silently mask a real Xano contract mismatch — see it fail
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  expect: {
    timeout: 15_000, // real network round-trips to Xano, not the in-process mock
  },
  timeout: 60_000, // whole-test timeout, generous for a multi-step real-network flow
  webServer: {
    command: "npm run build && npm run start",
    cwd: path.resolve(__dirname, "../../apps/web"),
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_API_MODE: "xano",
      NEXT_PUBLIC_XANO_API_BASE_URL: process.env.NEXT_PUBLIC_XANO_API_BASE_URL || "",
      NEXT_PUBLIC_XANO_AUTH_BASE_URL: process.env.NEXT_PUBLIC_XANO_AUTH_BASE_URL || "",
      NEXT_PUBLIC_XANO_AUTH_SIGNUP_PATH: process.env.NEXT_PUBLIC_XANO_AUTH_SIGNUP_PATH || "/auth/signup",
      NEXT_PUBLIC_XANO_AUTH_LOGIN_PATH: process.env.NEXT_PUBLIC_XANO_AUTH_LOGIN_PATH || "/auth/login",
      NEXT_PUBLIC_XANO_AUTH_ME_PATH: process.env.NEXT_PUBLIC_XANO_AUTH_ME_PATH || "/auth/me",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
