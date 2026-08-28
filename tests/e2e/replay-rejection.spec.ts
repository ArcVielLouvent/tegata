import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/mock/reset");
});

test("replaying a signature on an already-active warrant is rejected and shown in the UI", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("resource-select").selectOption("internal_wiki");
  await page.getByTestId("reason-input").fill("reading onboarding docs");
  await page.getByTestId("duration-input").fill("30");
  await page.getByTestId("requested-by-input").fill("newhire@example.com");
  await page.getByTestId("submit-request").click();

  const warrantId = (await page.getByTestId("warrant-result").locator("strong.mono").innerText()).trim();
  await page.getByRole("link", { name: "Go to Approver view →" }).click();

  // First signature: legitimate, activates the warrant.
  await page.getByTestId(`sign-${warrantId}`).click();
  await expect(page.getByTestId(`warrant-status-${warrantId}`)).toHaveText("active");

  // Second attempt on the same warrant: this is the replay attack. The
  // warrant is already used=true, so it must be rejected on that basis
  // alone — visibly, in the UI, per ROADMAP.md's Phase 6 "done when".
  const signButton = page.getByTestId(`sign-${warrantId}`);
  await expect(signButton).toHaveText("Replay attempt (sign again)");
  await signButton.click();

  const message = page.getByTestId(`warrant-message-${warrantId}`);
  await expect(message).toBeVisible();
  await expect(message).toContainText(/replay/i);
  await expect(message).toContainText(/already been used/i);

  // Status must remain active — a rejected replay must not silently
  // mutate state.
  await expect(page.getByTestId(`warrant-status-${warrantId}`)).toHaveText("active");

  // The audit trail must show exactly one "signed_and_activated" entry,
  // not two — the rejected replay must never have been appended.
  await page.goto(`/audit/${warrantId}`);
  const entries = page.getByTestId("audit-entries").locator('[data-testid^="audit-entry-"]');
  const events = await entries.locator("strong").allInnerTexts();
  const activationCount = events.filter((e) => e === "signed_and_activated").length;
  expect(activationCount).toBe(1);
  await expect(page.getByTestId("chain-integrity-banner")).toContainText("intact");
});
