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

async function signUpAndOnboard(page: Page, testInfo: TestInfo) {
  const username = usernameFor(testInfo);

  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel("Favorite brands").fill("Kapital, Our Legacy");
  await page.getByLabel("Categories").fill("jackets, knitwear");
  await page.getByLabel("Price preference").fill("$100-$500");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page).toHaveURL("/");

  return username;
}

test.beforeEach(async ({ context }) => {
  await context.route("https://**", (route) => route.abort("blockedbyclient"));
});

test("saved search, suggested pieces, and like suppression work as one signed-in journey", async ({
  page,
}, testInfo) => {
  await signUpAndOnboard(page, testInfo);

  await page.goto("/search?q=jacket&source=mock&sort=recommended");
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await page.getByRole("button", { name: "Save search" }).click();
  await expect(page.getByText("Saved this search to your profile.")).toBeVisible();

  await page.goto("/profile");
  const savedSearch = page
    .locator("article.recent-search-card")
    .filter({ has: page.getByRole("heading", { level: 2, name: "jacket" }) });
  await expect(savedSearch).toBeVisible();
  await savedSearch.getByRole("button", { name: "Open search" }).click();
  await expect(page).toHaveURL(/\/search\?.*q=jacket/);

  await page.goto("/suggested");
  await expect(page.getByRole("heading", { level: 1, name: "Suggested Pieces" })).toBeVisible();
  await expect(page.locator(".listing-card__reason").first()).toBeVisible();
  const suggestedCards = page.locator("article.listing-card");
  const initialSuggestionCount = await suggestedCards.count();
  expect(initialSuggestionCount).toBeGreaterThan(0);
  await suggestedCards.first().getByRole("button", { name: "Not for me" }).click();
  await expect(suggestedCards).toHaveCount(initialSuggestionCount - 1);

  await page.goto("/");
  const likeButton = page.getByRole("button", { name: "Save to likes" }).first();
  await likeButton.click();
  const unlikeButton = page.getByRole("button", { name: "Remove from likes" }).first();
  await expect(unlikeButton).toBeVisible();
  await unlikeButton.click();
  await expect(page.getByRole("button", { name: "Save to likes" }).first()).toBeVisible();
});

test("login, logout, and one-time password reset actions preserve session safety", async ({
  page,
}, testInfo) => {
  const username = await signUpAndOnboard(page, testInfo);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("banner").getByText(`@${username}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();

  let resetToken: string | undefined;
  await page.route(`${apiUrl}/auth/password-reset/request`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { accepted: true },
      status: 202,
    }),
  );
  await page.route(`${apiUrl}/auth/password-reset/complete`, async (route) => {
    resetToken = (route.request().postDataJSON() as { token?: string }).token;
    await route.fulfill({
      contentType: "application/json",
      json: { sessionsRevoked: 1, status: "password_reset" },
      status: 200,
    });
  });

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("reset@example.test");
  await page.getByRole("button", { name: "Request password reset" }).click();
  await expect(
    page.getByText(/This response does not confirm whether an account exists/),
  ).toBeVisible();

  await page.goto("/reset-password#token=one-time-reset-token");
  await expect(page).toHaveURL(`${webUrl}/reset-password`);
  await page.getByLabel("New password", { exact: true }).fill("A-New-Safe-Password!2026");
  await page.getByLabel("Confirm new password").fill("A-New-Safe-Password!2026");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByText("Password updated. Every existing session was revoked; log in again."),
  ).toBeVisible();
  expect(resetToken).toBe("one-time-reset-token");
});

test("verified email and SMS controls feed an alert that opens its exact listing", async ({
  page,
}, testInfo) => {
  const username = await signUpAndOnboard(page, testInfo);
  const now = "2026-07-26T18:00:00.000Z";
  let savedPreferences: Record<string, unknown> | undefined;
  const readiness = {
    email: {
      available: true,
      configured: true,
      identityPresent: true,
      ready: true,
      suppressed: false,
      verified: true,
    },
    inApp: {
      available: true,
      configured: true,
      ready: true,
    },
    push: {
      available: false,
      configured: false,
      ready: false,
    },
    sms: {
      available: true,
      configured: true,
      consented: true,
      identityPresent: true,
      ready: true,
      suppressed: false,
      verified: true,
    },
  };
  const initialPreferences = {
    createdAt: now,
    emailEnabled: false,
    frequency: "instant",
    inAppEnabled: true,
    pushEnabled: false,
    quietHoursEnd: undefined,
    quietHoursStart: undefined,
    smsEnabled: false,
    timezone: "America/New_York",
    updatedAt: now,
    userId: username,
  };

  await page.route(`${apiUrl}/me/notification-preferences`, async (route) => {
    if (route.request().method() === "PATCH") {
      savedPreferences = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        json: {
          deliveryReadiness: readiness,
          notificationPreferences: {
            ...initialPreferences,
            ...savedPreferences,
          },
          phoneIdentity: {
            phoneE164: "+12025550123",
            userId: username,
            verifiedAt: now,
          },
          userId: username,
        },
        status: 200,
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: {
        deliveryReadiness: readiness,
        notificationPreferences: initialPreferences,
        phoneIdentity: {
          phoneE164: "+12025550123",
          userId: username,
          verifiedAt: now,
        },
        userId: username,
      },
      status: 200,
    });
  });

  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { level: 2, name: "Notification preferences" }),
  ).toBeVisible();
  const globalChannels = page
    .locator("fieldset.notification-choice-group")
    .filter({ hasText: "Global channels" });
  await globalChannels
    .locator("label")
    .filter({ has: page.getByText("Email", { exact: true }) })
    .locator("input")
    .check();
  await globalChannels
    .locator("label")
    .filter({ has: page.getByText("SMS", { exact: true }) })
    .locator("input")
    .check();
  await page.locator("#notification-frequency").selectOption("daily");
  await page.locator("#notification-timezone").fill("America/New_York");
  await page.locator("#notification-quiet-start").fill("22:00");
  await page.locator("#notification-quiet-end").fill("07:00");
  await page.getByRole("button", { name: "Save notification preferences" }).click();
  await expect(page.getByText("Notification delivery preferences were saved.")).toBeVisible();
  expect(savedPreferences).toMatchObject({
    emailEnabled: true,
    frequency: "daily",
    inAppEnabled: true,
    quietHoursEnd: "07:00",
    quietHoursStart: "22:00",
    smsEnabled: true,
    timezone: "America/New_York",
  });

  await page.route(`${apiUrl}/me/alerts`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        alerts: [
          {
            firstMatchedAt: now,
            id: "alert-1",
            lastMatchedAt: now,
            listingId: "ebay:alert-item",
            reasons: [
              {
                code: "price_match",
                label: "Price range matched",
              },
            ],
            state: "unseen",
            userId: username,
            watchlistId: "watchlist-1",
          },
        ],
        unseenCount: 1,
        userId: username,
      },
      status: 200,
    }),
  );
  await page.route(`${apiUrl}/me/alerts/seen`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { alertMatchId: "alert-1", state: "seen" },
      status: 200,
    }),
  );
  await page.route(new RegExp(`${apiUrl}/listings/[^/]+/price-trends(?:\\?.*)?$`), (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        error: "price_intelligence_unavailable",
        message: "No durable price history exists for this fixture.",
      },
      status: 503,
    }),
  );
  await page.route(new RegExp(`${apiUrl}/listings/[^/]+$`), (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        listing: {
          brand: {
            id: "brand:our-legacy",
            name: "Our Legacy",
            slug: "our-legacy",
          },
          fetchedAt: now,
          id: "ebay:alert-item",
          imageUrl: "/listing-placeholder.svg",
          listingType: "buy_now",
          price: {
            amount: 180,
            amountMinor: 18_000,
            currency: "USD",
            fractionDigits: 2,
          },
          providerId: "ebay",
          providerListingId: "alert-item",
          source: {
            id: "ebay",
            marketplaceId: "ebay",
            name: "eBay",
          },
          sourceUrl: "https://www.ebay.com/itm/alert-item",
          title: "Our Legacy archive jacket",
        },
      },
      status: 200,
    }),
  );

  await page.goto("/alerts");
  await expect(page.getByText("Price range matched")).toBeVisible();
  await page.getByRole("button", { name: "Mark alert alert-1 as seen" }).click();
  await expect(page.getByText("Alert marked as seen.")).toBeVisible();
  await page.getByRole("link", { name: "Open listing" }).click();
  await expect(page).toHaveURL("/listings/ebay%3Aalert-item");
  await expect(
    page.getByRole("heading", { level: 1, name: "Our Legacy archive jacket" }),
  ).toBeVisible();
});

test("portable account export and confirmed deletion have complete UI handoffs", async ({
  page,
}, testInfo) => {
  const username = await signUpAndOnboard(page, testInfo);
  let exportToken: string | undefined;

  await page.route(`${apiUrl}/account/export`, async (route) => {
    exportToken = (route.request().postDataJSON() as { token?: string }).token;
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          account: { username },
          savedSearches: [],
          watchlists: [],
        },
        status: "exported",
      },
      status: 200,
    });
  });

  await page.goto("/account/export#token=portable-export-token");
  await expect(page).toHaveURL(`${webUrl}/account/export`);
  await page.getByRole("button", { name: "Prepare account export" }).click();
  await expect(
    page.getByText("Export prepared. This data is held only in this page until you navigate away."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download JSON export" })).toBeVisible();
  expect(exportToken).toBe("portable-export-token");

  await page.route(`${apiUrl}/me`, (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({
        contentType: "application/json",
        json: { deleted: true },
        status: 200,
      });
    }
    return route.continue();
  });
  await page.goto("/profile");
  await page.locator("#delete-account-username").fill(username);
  await page.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Your account and its stored data were deleted.")).toBeVisible();
});
