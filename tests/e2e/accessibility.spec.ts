import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const apiUrl = "http://127.0.0.1:4400";
const password = "Correct-Horse-Battery-Staple!42";
const persistenceDriver = process.env.PLAYWRIGHT_PERSISTENCE_DRIVER ?? "sqlite";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function formatViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown impact"}): ${violation.help}\n` +
        violation.nodes
          .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? node.html}`)
          .join("\n"),
    )
    .join("\n\n");
}

async function expectNoWcagViolations(page: Page, surface: string) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();

  expect(
    results.violations,
    `${surface} has WCAG A/AA violations:\n${formatViolations(results.violations)}`,
  ).toEqual([]);
}

async function signUp(page: Page) {
  const username = `axe-${Date.now().toString(36)}`;

  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Tell us what you like" }),
  ).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.route("https://**", (route) => route.abort("blockedbyclient"));
});

test("signed-out home and login meet core WCAG A and AA rules", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Find your next piece" })).toBeVisible();
  await expect(page.getByText("Mock fixture").first()).toBeVisible();
  await expectNoWcagViolations(page, "Signed-out home");

  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Log In" })).toBeVisible();
  await expectNoWcagViolations(page, "Login");
});

test("signed-in profile and alerts meet core WCAG A and AA rules", async ({ page }) => {
  await signUp(page);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Profile" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account security and data" })).toBeVisible();
  await expectNoWcagViolations(page, "Signed-in profile");

  if (persistenceDriver === "sqlite") {
    const sessionResponse = await page.request.get(`${apiUrl}/auth/me`);
    expect(sessionResponse.ok()).toBeTruthy();
    const session = (await sessionResponse.json()) as { userId: string };

    await page.route(`${apiUrl}/me/alerts`, (route) =>
      route.fulfill({
        contentType: "application/json",
        json: {
          alerts: [],
          unseenCount: 0,
          userId: session.userId,
        },
        status: 200,
      }),
    );
  }

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Alerts" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "No alert matches yet" })).toBeVisible();
  await expectNoWcagViolations(page, "Signed-in alert inbox");
});
