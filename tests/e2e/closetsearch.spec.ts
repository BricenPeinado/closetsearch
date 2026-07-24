import { expect, test, type Page, type TestInfo } from "@playwright/test";

const apiUrl = "http://127.0.0.1:4400";
const webUrl = "http://127.0.0.1:4173";
const password = "Correct-Horse-Battery-Staple!42";

function usernameFor(testInfo: TestInfo) {
  const stableName = testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return `${stableName}-${testInfo.retry}-${Date.now().toString(36)}`;
}

async function signUp(page: Page, testInfo: TestInfo) {
  const username = usernameFor(testInfo);

  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Tell us what you like" }),
  ).toBeVisible();

  return username;
}

test.beforeEach(async ({ context }) => {
  await context.route("https://**", (route) => route.abort("blockedbyclient"));
});

test("signed-out discovery stays useful and keeps account data protected", async ({
  page,
  request,
}) => {
  const providerResponse = await request.get(`${apiUrl}/providers/health`);
  expect(providerResponse.ok()).toBeTruthy();

  const providerHealth = (await providerResponse.json()) as {
    providerRuntimeMode: string;
    providers: Array<{
      active: boolean;
      id: string;
      providerMode: string;
    }>;
  };
  expect(providerHealth.providerRuntimeMode).toBe("mock");
  expect(
    providerHealth.providers.filter((provider) => provider.active).map((provider) => provider.id),
  ).toEqual(["mock"]);
  expect(
    providerHealth.providers.some(
      (provider) => provider.active && provider.providerMode === "real",
    ),
  ).toBe(false);

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Find your next piece" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  await expect(page.getByText("Mock fixture").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to likes" }).first()).toBeVisible();

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Profile" })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Profile needs an account" }),
  ).toBeVisible();
});

test("signed-in onboarding and likes persist through the API-backed UI", async ({
  page,
}, testInfo) => {
  const username = await signUp(page, testInfo);

  await page.getByLabel("Favorite brands").fill("Our Legacy, Kapital");
  await page.getByLabel("Categories").fill("jackets, knitwear");
  await page.getByLabel("Price preference").fill("$100-$500");
  await page.getByRole("button", { name: "Save preferences" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(`@${username}`)).toBeVisible();

  const likeButton = page.getByRole("button", { name: "Save to likes" }).first();
  await expect(likeButton).toBeVisible();
  await likeButton.click();
  await expect(page.getByRole("button", { name: "Remove from likes" }).first()).toBeVisible();

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Profile" })
    .click();

  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Liked items" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove from likes" }).first()).toBeVisible();
});

test("a degraded provider preserves successful results and explains the partial state", async ({
  page,
}) => {
  await page.route(`${apiUrl}/feed?**`, async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      providers: unknown[];
    };

    payload.providers.push({
      failure: {
        code: "timeout",
        message: "Recorded test timeout.",
        retryable: true,
      },
      latencyMs: 5_000,
      providerId: "fixture-degraded-market",
      providerName: "Fixture Degraded Market",
      resultCount: 0,
      status: "failure",
    });

    await route.fulfill({
      response,
      json: payload,
    });
  });

  await page.goto("/");

  await expect(page.getByText("Mock fixture").first()).toBeVisible();
  await expect(
    page.getByText(
      "Partial results: Fixture Degraded Market was unavailable while loading the feed. You can retry without losing successful results.",
    ),
  ).toBeVisible();
});

test("revoked sessions surface the session-expired recovery state", async ({ page }, testInfo) => {
  await signUp(page, testInfo);
  await page.goto("/");

  const likeButton = page.getByRole("button", { name: "Save to likes" }).first();
  await expect(likeButton).toBeVisible();

  const revokeResponse = await page.request.post(`${apiUrl}/auth/logout-all`, {
    headers: {
      origin: webUrl,
    },
  });
  expect(revokeResponse.ok()).toBeTruthy();

  await likeButton.click();

  await expect(
    page.getByText(
      "Your session expired or you were signed out. Log in again to keep saving likes, searches, and watchlists.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in again" })).toBeVisible();
});
