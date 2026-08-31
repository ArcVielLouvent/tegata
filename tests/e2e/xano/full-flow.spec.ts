import { test, expect } from "@playwright/test";

/**
 * Fully self-contained — no manual Xano setup, no persistent test
 * account, no GitHub secrets beyond the two Xano base URLs. Both the
 * requester and approver accounts are created fresh on every run.
 *
 * HOW THE APPROVER ACCOUNT GETS ITS ROLE WITHOUT A UI ROLE SELECTOR:
 * POST /auth/signup was given an OPTIONAL `role` input (restricted to
 * "requester" | "approver" only — never "security_admin" — see
 * docs/xano-setup.md §9d). The app's own login/register FORM never
 * sends this — a real user has no way to self-assign a role, which is
 * the point. This test calls the signup endpoint directly over HTTP via
 * Playwright's `request` fixture (bypassing the browser/UI entirely) to
 * create the approver account, then uses the normal browser UI for
 * everything else, including logging that account in through the
 * regular login form. The requester account is created the ordinary
 * way, through the UI, with no role field at all.
 */

const AUTH_BASE = process.env.NEXT_PUBLIC_XANO_AUTH_BASE_URL || "";
const SIGNUP_PATH = process.env.NEXT_PUBLIC_XANO_AUTH_SIGNUP_PATH || "/auth/signup";

test("full flow against real Xano: register -> request -> approver signs -> active -> replay rejected", async ({ page, request }) => {
  const runId = Date.now();
  const requesterEmail = `e2e-requester-${runId}@tegata.test`;
  const requesterPassword = "Test-Password-123!";
  const approverEmail = `e2e-approver-${runId}@tegata.test`;
  const approverPassword = "Test-Password-123!";

  // --- Create the approver account directly via the API (role="approver"),
  // never through the UI — see header comment. ---
  const signupRes = await request.post(`${AUTH_BASE}${SIGNUP_PATH}`, {
    data: { name: "E2E Approver", email: approverEmail, password: approverPassword, role: "approver" },
  });
  expect(
    signupRes.ok(),
    `Direct signup for the approver account failed (${signupRes.status()}). If this is a 400 on the ` +
      "`role` field, docs/xano-setup.md §9d's optional-role change to POST /auth/signup may not be " +
      "published yet — see this file's header comment for the exact prompt used to build it."
  ).toBeTruthy();

  // --- Register the requester through the normal UI (no role field exists here) ---
  await page.goto("/login");
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  await page.getByTestId("name-input").fill("E2E Requester");
  await page.getByTestId("email-input").fill(requesterEmail);
  await page.getByTestId("password-input").fill(requesterPassword);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL("/");

  // --- Submit a low-risk request (single approver, keeps this test
  // independent of the 2-approver/Foxit-envelope gap documented in
  // apiClient.ts's signWarrant()) ---
  await page.getByTestId("resource-select").selectOption("internal_wiki");
  await page.getByTestId("reason-input").fill("e2e test — reading onboarding docs");
  await page.getByTestId("duration-input").fill("30");
  await page.getByTestId("submit-request").click();

  const result = page.getByTestId("warrant-result");
  await expect(result).toBeVisible({ timeout: 15_000 }); // real network round-trip, more generous than mock mode
  const requiredCount = await page.getByTestId("required-approver-count").innerText();
  expect(Number(requiredCount)).toBe(1); // internal_wiki is always low-risk regardless of time-of-day
  const warrantId = (await result.locator("strong.mono").innerText()).trim();

  // --- Switch to the approver account (logs in normally — no role field
  // in this form either, the role was already set at creation above) ---
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL("/login");
  await page.getByTestId("email-input").fill(approverEmail);
  await page.getByTestId("password-input").fill(approverPassword);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL("/");

  // --- Sign it ---
  await page.goto("/approver");
  const card = page.getByTestId(`warrant-card-${warrantId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`warrant-status-${warrantId}`)).toHaveText("pending_approval");

  await page.getByTestId(`sign-${warrantId}`).click();
  await expect(page.getByTestId(`warrant-status-${warrantId}`)).toHaveText("active", { timeout: 15_000 });
  await expect(page.getByTestId(`warrant-message-${warrantId}`)).toContainText("activated");

  // --- Replay attempt: sign the same warrant again ---
  const signButton = page.getByTestId(`sign-${warrantId}`);
  await expect(signButton).toHaveText("Replay attempt (sign again)");
  await signButton.click();

  const message = page.getByTestId(`warrant-message-${warrantId}`);
  await expect(message).toBeVisible({ timeout: 15_000 });
  await expect(message).toContainText(/replay/i);
  await expect(page.getByTestId(`warrant-status-${warrantId}`)).toHaveText("active"); // must not have changed
});
