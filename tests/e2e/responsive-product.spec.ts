import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const apiUrl = "http://127.0.0.1:4400";
const listingId = "yahoo-auctions-jp:responsive-fixture";
const encodedListingId = encodeURIComponent(listingId);
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function installJapaneseListingFixture(page: Page) {
  await page.route(`${apiUrl}/providers/health`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        providerRuntimeMode: "real",
        providers: [
          {
            active: true,
            displayName: "Depop",
            id: "depop",
            implementationStatus: "available",
          },
          {
            active: true,
            displayName: "eBay",
            id: "ebay",
            implementationStatus: "available",
          },
          {
            active: true,
            displayName: "Grailed",
            id: "grailed",
            implementationStatus: "available",
          },
          {
            active: true,
            displayName: "Mercari Japan",
            id: "mercari-jp",
            implementationStatus: "available",
          },
          {
            active: true,
            displayName: "Yahoo! Auctions Japan",
            id: "yahoo-auctions-jp",
            implementationStatus: "available",
          },
        ],
      },
      status: 200,
    }),
  );

  await page.route(`${apiUrl}/feed?**`, async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      listings: Array<Record<string, unknown>>;
      recommendation?: Record<string, unknown>;
    };
    const fixture = payload.listings[0] ?? {};

    payload.listings = [
      {
        ...fixture,
        auction: {
          bidCount: 12,
          buyNowPrice: {
            amount: 32_000,
            amountMinor: 32_000,
            currency: "JPY",
            fractionDigits: 0,
          },
          currentBid: {
            amount: 24_800,
            amountMinor: 24_800,
            currency: "JPY",
            fractionDigits: 0,
          },
          endsAt: "2026-08-02T12:00:00.000Z",
        },
        brand: {
          id: "brand:comme-des-garcons",
          name: "Comme des Garçons",
          slug: "comme-des-garcons",
        },
        description: "A black wool runway jacket in excellent condition.",
        fetchedAt: "2026-07-26T16:00:00.000Z",
        id: listingId,
        imageUrl: "/listing-placeholder.svg",
        images: [
          {
            alt: "Front of black jacket",
            role: "primary",
            url: "/listing-placeholder.svg",
          },
          {
            alt: "Back of black jacket",
            role: "gallery",
            url: "/listing-placeholder.svg?view=back",
          },
        ],
        listingType: "auction",
        marketplaceLimitations: {
          closetSearchRole: "discovery_only",
          internationalShipping: "proxy_only",
          notices: [
            "Domestic Japanese delivery only.",
            "Proxy, duties, and import fees are not included.",
          ],
          proxyPurchaseRequired: true,
        },
        originalDescription: "黒のウールジャケット。状態は良好です。",
        originalLanguage: "ja",
        originalTitle: "コムデギャルソン 黒 ウールジャケット",
        price: {
          amount: 24_800,
          amountMinor: 24_800,
          currency: "JPY",
          fractionDigits: 0,
        },
        pricing: {
          display: {
            amount: 168.64,
            amountMinor: 16_864,
            currency: "USD",
            exchangeRate: "0.0068",
            exchangeRateSource: "Open Exchange Rates fixture",
            exchangeRateTimestamp: "2026-07-26T15:00:00.000Z",
            fractionDigits: 2,
            sourceAmountMinor: 24_800,
            sourceCurrency: "JPY",
          },
          landed: {
            amount: 188.64,
            amountMinor: 18_864,
            currency: "USD",
            fractionDigits: 2,
          },
          original: {
            amount: 24_800,
            amountMinor: 24_800,
            currency: "JPY",
            fractionDigits: 0,
          },
          shipping: {
            amount: 20,
            amountMinor: 2_000,
            currency: "USD",
            fractionDigits: 2,
          },
        },
        providerId: "yahoo-auctions-jp",
        providerListingId: "responsive-fixture",
        shipping: {
          available: true,
          cost: {
            amount: 20,
            amountMinor: 2_000,
            currency: "USD",
            fractionDigits: 2,
          },
          destinationCountry: "US",
          originCountry: "JP",
          type: "proxy estimate",
        },
        source: {
          id: "yahoo-auctions-jp",
          marketplaceId: "yahoo-auctions-jp",
          name: "Yahoo! Auctions Japan",
        },
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/responsive-fixture",
        title: "Comme des Garçons black wool jacket",
        translatedDescription: "A black wool runway jacket in excellent condition.",
        translatedLanguage: "en",
        translatedTitle: "Comme des Garçons black wool jacket",
      },
    ];
    payload.recommendation = {
      rankedItems: [
        {
          listingId,
          rank: 1,
          reasonCodes: ["brand_affinity"],
        },
      ],
      rolloutMode: "active",
      strategy: "rules",
      usedModel: false,
    };

    await route.fulfill({ json: payload, response });
  });

  await page.route(
    new RegExp(`/listings/${encodedListingId}/price-trends(?:\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          counts: {
            byMarketplace: { "Yahoo! Auctions Japan": 4 },
            byMarketStatus: { active: 2, sold: 2 },
            byObservationKind: {
              asking: 1,
              auction_bid: 1,
              auction_completed: 1,
              confirmed_sold: 1,
            },
          },
          currency: "JPY",
          filters: {},
          listingId,
          series: [
            {
              amountMinor: 28_000,
              currency: "JPY",
              marketplace: "Yahoo! Auctions Japan",
              marketStatus: "active",
              observationKind: "asking",
              observedAt: "2026-05-01T12:00:00.000Z",
              providerId: "yahoo-auctions-jp",
            },
            {
              amountMinor: 25_500,
              currency: "JPY",
              marketplace: "Yahoo! Auctions Japan",
              marketStatus: "sold",
              observationKind: "confirmed_sold",
              observedAt: "2026-06-01T12:00:00.000Z",
              providerId: "yahoo-auctions-jp",
            },
            {
              amountMinor: 24_800,
              bidCount: 12,
              currency: "JPY",
              marketplace: "Yahoo! Auctions Japan",
              marketStatus: "active",
              observationKind: "auction_bid",
              observedAt: "2026-07-20T12:00:00.000Z",
              providerId: "yahoo-auctions-jp",
            },
            {
              amountMinor: 26_100,
              currency: "JPY",
              marketplace: "Yahoo! Auctions Japan",
              marketStatus: "sold",
              observationKind: "auction_completed",
              observedAt: "2026-07-25T12:00:00.000Z",
              providerId: "yahoo-auctions-jp",
            },
          ],
          state: "ready",
          summary: {
            changes: {
              days30: {
                absoluteMinor: -700,
                baselineAmountMinor: 26_500,
                baselineObservedAt: "2026-06-25T12:00:00.000Z",
                percent: -2.6415,
              },
              days90: {
                absoluteMinor: -1_900,
                baselineAmountMinor: 27_700,
                baselineObservedAt: "2026-05-01T12:00:00.000Z",
                percent: -6.8592,
              },
            },
            confidence: {
              level: "medium",
              reasons: ["Four reviewed observations across distinct market states."],
              score: 0.72,
            },
            freshness: {
              ageSeconds: 86_400,
              isStale: false,
              latestObservedAt: "2026-07-25T12:00:00.000Z",
            },
            iqrMinor: 1_850,
            medianMinor: 25_800,
            q1Minor: 24_800,
            q3Minor: 26_650,
            sampleSize: 4,
          },
        },
        status: 200,
      });
    },
  );
}

test.beforeEach(async ({ context, page }) => {
  await context.route("https://**", (route) => route.abort("blockedbyclient"));
  await installJapaneseListingFixture(page);
});

test("search filters adapt between sidebar and touch drawer", async ({ page }, testInfo) => {
  await page.goto("/search?q=jacket&brands=Kapital&sort=ending_soon&source=yahoo-auctions-jp");
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Brand: Kapital" })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Remove Marketplace: yahoo-auctions-jp",
    }),
  ).toBeVisible();

  const drawer = page.locator(".search-panel__drawer");
  const mobileOrTablet = testInfo.project.name !== "chromium";

  if (mobileOrTablet) {
    const trigger = page.locator(".search-panel__mobile-trigger");
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  } else {
    await expect(page.locator(".search-panel__mobile-trigger")).toBeHidden();
    await expect(drawer).toBeVisible();
  }
});

test("Japanese auction detail and observed price trend are transparent and accessible", async ({
  page,
}) => {
  await page.goto("/");
  const listingLink = page
    .locator(".listing-card__link")
    .filter({ hasText: "Comme des Garçons black wool jacket" });
  await expect(listingLink).toBeVisible();
  await listingLink.click();

  await expect(page).toHaveURL(`/listings/${encodedListingId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Comme des Garçons black wool jacket" }),
  ).toBeVisible();
  await expect(page.getByText("Original Japanese title")).toBeVisible();
  await expect(page.getByText("コムデギャルソン 黒 ウールジャケット")).toBeVisible();
  await expect(page.getByText("¥24,800").first()).toBeVisible();
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("Domestic Japanese delivery only.")).toBeVisible();
  await expect(page.getByText("Open Exchange Rates fixture")).toBeVisible();

  await expect(page.getByRole("img", { name: "Listing price history" })).toBeVisible();
  await expect(page.getByText("Confirmed sold", { exact: true })).toBeVisible();
  await expect(page.getByText("Auction bid", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed auction", { exact: true })).toBeVisible();
  await expect(page.getByText("Quartile range", { exact: true })).toBeVisible();
  await expect(page.getByText("4 observations")).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(
    results.violations,
    results.violations
      .map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);
});
