import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Brand } from "@closetsearch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "./app.js";
import { resetLikeStore } from "./like-service.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "./db/test-helpers.js";
import { resetRecentSearchStore } from "./recent-search-service.js";
import { resetSavedSearchStore } from "./saved-search-service.js";
import { resetEngagementStore } from "./services/engagementService.js";
import { resetListingCatalog } from "./services/listingCatalogService.js";
import { resetUserStore } from "./user-service.js";

function createResponseRecorder() {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = "";

  const response = {
    end(chunk?: string) {
      body = chunk ?? "";
      return response;
    },
    writeHead(code: number, nextHeaders: Record<string, string>) {
      statusCode = code;
      headers = nextHeaders;
      return response;
    },
  } as unknown as ServerResponse<IncomingMessage>;

  return {
    response,
    snapshot: () => ({
      body,
      headers,
      statusCode,
    }),
  };
}

function createJsonRequest(method: string, url: string, body?: unknown) {
  const json = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from(json ? [json] : []) as IncomingMessage;

  stream.method = method;
  stream.url = url;

  return stream;
}

describe("handleRequest", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("app");
    resetUserStore();
    resetLikeStore();
    resetEngagementStore();
    resetListingCatalog();
    resetRecentSearchStore();
    resetSavedSearchStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("returns a healthy JSON response from /health", async () => {
    const request = {
      method: "GET",
      url: "/health",
    } as IncomingMessage;

    const recorder = createResponseRecorder();

    await handleRequest(request, recorder.response);

    expect(recorder.snapshot()).toMatchObject({
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8",
      },
      statusCode: 200,
    });

    expect(JSON.parse(recorder.snapshot().body)).toMatchObject({
      service: "closetsearch-api",
      status: "ok",
    });
  });

  it("returns provider health metadata without exposing secrets", async () => {
    const previousMode = process.env.PROVIDER_RUNTIME_MODE;
    const previousEnabled = process.env.GRAILED_PROVIDER_ENABLED;
    const previousScrapingAllowed = process.env.GRAILED_SCRAPING_ALLOWED;
    const previousUserAgent = process.env.GRAILED_USER_AGENT;

    process.env.PROVIDER_RUNTIME_MODE = "hybrid";
    process.env.GRAILED_PROVIDER_ENABLED = "true";
    process.env.GRAILED_SCRAPING_ALLOWED = "true";
    process.env.GRAILED_USER_AGENT = "ClosetSearchBot/0.1 contact:team.com";

    const recorder = createResponseRecorder();

    try {
      await handleRequest(
        {
          method: "GET",
          url: "/providers/health",
        } as IncomingMessage,
        recorder.response,
      );
    } finally {
      if (previousMode === undefined) delete process.env.PROVIDER_RUNTIME_MODE;
      else process.env.PROVIDER_RUNTIME_MODE = previousMode;
      if (previousEnabled === undefined) delete process.env.GRAILED_PROVIDER_ENABLED;
      else process.env.GRAILED_PROVIDER_ENABLED = previousEnabled;
      if (previousScrapingAllowed === undefined) delete process.env.GRAILED_SCRAPING_ALLOWED;
      else process.env.GRAILED_SCRAPING_ALLOWED = previousScrapingAllowed;
      if (previousUserAgent === undefined) delete process.env.GRAILED_USER_AGENT;
      else process.env.GRAILED_USER_AGENT = previousUserAgent;
    }

    expect(recorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(recorder.snapshot().body) as {
      providerRuntimeMode: string;
      providers: Array<{
        active: boolean;
        configured: boolean;
        displayName: string;
        id: string;
        mode: string;
        providerMode: string;
        requiredEnvVars?: string[];
        scrapingAllowed?: boolean;
      }>;
    };

    expect(body.providerRuntimeMode).toBe("hybrid");
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mock",
          displayName: "Mock Closet",
          active: true,
          configured: true,
          mode: "fixture",
          providerMode: "mock",
        }),
        expect.objectContaining({
          id: "grailed",
          displayName: "Grailed",
          active: true,
          configured: true,
          mode: "authorized-live",
          providerMode: "real",
          scrapingAllowed: true,
          requiredEnvVars: expect.arrayContaining([
            "GRAILED_PROVIDER_ENABLED",
            "GRAILED_SCRAPING_ALLOWED",
            "GRAILED_BASE_URL",
            "GRAILED_USER_AGENT",
          ]),
        }),
      ]),
    );
    expect(recorder.snapshot().body).not.toContain("super-secret-key");
  });

  it("creates and logs in a user through auth endpoints", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "archivekid",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    expect(signupRecorder.snapshot().statusCode).toBe(201);

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      user: {
        currencyPreference: string;
        onboardingPreferences: { favoriteBrands: string[] };
        username: string;
      };
      userId: string;
    };

    expect(signupBody.userId).toBeTruthy();
    expect(signupBody.user.username).toBe("archivekid");
    expect(signupBody.user.currencyPreference).toBe("USD");
    expect(signupBody.user.onboardingPreferences.favoriteBrands).toEqual([]);

    const loginRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/login", {
        username: "archivekid",
        password: "mohair",
      }),
      loginRecorder.response,
    );

    expect(loginRecorder.snapshot().statusCode).toBe(200);

    const loginBody = JSON.parse(loginRecorder.snapshot().body) as {
      userId: string;
    };

    expect(loginBody.userId).toBe(signupBody.userId);
  });

  it("saves onboarding preferences for a user", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "closetlover",
        password: "jacket",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    const onboardingRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/users/onboarding", {
        userId: signupBody.userId,
        preferences: {
          favoriteBrands: ["Our Legacy", "Acne Studios"],
          categories: ["jackets", "knitwear"],
          priceRange: "$100-$300",
        },
      }),
      onboardingRecorder.response,
    );

    expect(onboardingRecorder.snapshot().statusCode).toBe(200);

    const onboardingBody = JSON.parse(onboardingRecorder.snapshot().body) as {
      user: {
        onboardingPreferences: {
          categories: string[];
          favoriteBrands: string[];
          priceRange: string;
        };
      };
    };

    expect(onboardingBody.user.onboardingPreferences).toEqual({
      favoriteBrands: ["Our Legacy", "Acne Studios"],
      categories: ["jackets", "knitwear"],
      priceRange: "$100-$300",
    });
  });

  it("creates and removes likes for a user", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "liker",
        password: "heart",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    const createLikeRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/likes", {
        userId: signupBody.userId,
        listingId: "mock:mock-jacket-001",
        source: "mock",
      }),
      createLikeRecorder.response,
    );

    expect(createLikeRecorder.snapshot().statusCode).toBe(201);

    const getLikesRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/likes/${signupBody.userId}`,
      } as IncomingMessage,
      getLikesRecorder.response,
    );

    const getLikesBody = JSON.parse(getLikesRecorder.snapshot().body) as {
      likes: Array<{ listingId: string; source: string }>;
    };

    expect(getLikesBody.likes).toHaveLength(1);
    expect(getLikesBody.likes[0]).toMatchObject({
      listingId: "mock:mock-jacket-001",
      source: "mock",
    });

    const deleteLikeRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("DELETE", "/likes", {
        userId: signupBody.userId,
        listingId: "mock:mock-jacket-001",
      }),
      deleteLikeRecorder.response,
    );

    expect(deleteLikeRecorder.snapshot().statusCode).toBe(200);
    expect(JSON.parse(deleteLikeRecorder.snapshot().body)).toEqual({
      removed: true,
    });
  });

  it("returns normalized search results from /search", async () => {
    const request = {
      method: "GET",
      url: "/search?q=jacket",
    } as IncomingMessage;

    const recorder = createResponseRecorder();

    await handleRequest(request, recorder.response);

    expect(recorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(recorder.snapshot().body) as {
      listings: Array<{
        brand: { name: string };
        providerId: string;
        riskSignal?: {
          explanation: string;
          riskLevel: string;
        };
        title: string;
      }>;
      pagination: {
        hasMore: boolean;
        page: number;
        pageSize: number;
        totalCount?: number;
      };
      query: { text: string };
    };

    expect(body.query.text).toBe("jacket");
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(24);
    expect(body.pagination.totalCount).toBeGreaterThan(0);
    expect(body.listings[0]).toMatchObject({
      providerId: "mock",
      riskSignal: {
        riskLevel: expect.any(String),
      },
    });
    expect(body.listings.some((listing) => listing.title.toLowerCase().includes("jacket"))).toBe(
      true,
    );
    expect(body.listings[0]?.riskSignal?.explanation).toBeTruthy();
  });

  it("supports normalized sort and listing type filters on /search", async () => {
    const request = {
      method: "GET",
      url: "/search?q=jacket&sort=price_asc&listingType=auction&source=mock",
    } as IncomingMessage;

    const recorder = createResponseRecorder();

    await handleRequest(request, recorder.response);

    expect(recorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(recorder.snapshot().body) as {
      listings: Array<{
        listingType: string;
        price: { amount: number };
        providerId: string;
        riskSignal?: {
          riskLevel: string;
        };
      }>;
      pagination: {
        hasMore: boolean;
        page: number;
        pageSize: number;
        totalCount?: number;
      };
      query: {
        listingTypes?: string[];
        page?: number;
        pageSize?: number;
        sort?: string;
        sourceIds?: string[];
      };
    };

    expect(body.query.sort).toBe("price_asc");
    expect(body.query.listingTypes).toEqual(["auction"]);
    expect(body.query.sourceIds).toEqual(["mock"]);
    expect(body.query.page).toBe(1);
    expect(body.query.pageSize).toBe(24);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(24);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({
      listingType: "auction",
      providerId: "mock",
      riskSignal: {
        riskLevel: expect.any(String),
      },
    });
    expect(body.listings[0]?.price.amount).toBe(195);
  });

  it("returns paginated normalized feed results from /feed", async () => {
    const request = {
      method: "GET",
      url: "/feed?page=1&pageSize=4",
    } as IncomingMessage;

    const recorder = createResponseRecorder();

    await handleRequest(request, recorder.response);

    expect(recorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(recorder.snapshot().body) as {
      isPersonalized: boolean;
      listings: Array<{
        brand: { name: string };
        providerId: string;
        riskSignal?: {
          explanation: string;
          riskLevel: string;
        };
        source: { name: string };
        sourceUrl: string;
        title: string;
      }>;
      pagination: {
        hasMore: boolean;
        nextPage?: number;
        page: number;
        pageSize: number;
        totalCount?: number;
      };
    };

    expect(body.isPersonalized).toBe(false);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(4);
    expect(body.pagination.totalCount).toBeGreaterThan(4);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextPage).toBe(2);
    expect(body.listings).toHaveLength(4);
    expect(body.listings[0]).toMatchObject({
      brand: {
        name: "Our Legacy",
      },
      providerId: "mock",
      riskSignal: {
        riskLevel: expect.any(String),
      },
      source: {
        name: "Mock Closet",
      },
    });
    expect(body.listings[0].sourceUrl).toContain("https://");
    expect(body.listings[0]?.riskSignal?.explanation).toBeTruthy();
  });

  it("lists brands from /brands and filters by query", async () => {
    const recorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: "/brands?q=streetwear",
      } as IncomingMessage,
      recorder.response,
    );

    expect(recorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(recorder.snapshot().body) as {
      brands: Brand[];
      query?: string;
      total: number;
    };

    expect(body.query).toBe("streetwear");
    expect(body.total).toBeGreaterThan(0);
    expect(body.brands.some((brand) => brand.name === "Supreme")).toBe(true);
    expect(body.brands.some((brand) => brand.name === "Undercover")).toBe(true);
  });

  it("returns a single brand by slug from /brands/:slug", async () => {
    const recorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: "/brands/kapital",
      } as IncomingMessage,
      recorder.response,
    );

    expect(recorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(recorder.snapshot().body) as {
      brand: Brand;
    };

    expect(body.brand).toMatchObject({
      slug: "kapital",
      name: "Kapital",
    });
    expect(body.brand.tags).toContain("japanese");
  });

  it("returns 404 when a brand slug is unknown", async () => {
    const recorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: "/brands/not-a-brand",
      } as IncomingMessage,
      recorder.response,
    );

    expect(recorder.snapshot().statusCode).toBe(404);
  });

  it("returns a locked analytics overview for missing or non-premium users", async () => {
    const lockedRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: "/analytics/overview",
      } as IncomingMessage,
      lockedRecorder.response,
    );

    expect(lockedRecorder.snapshot().statusCode).toBe(200);

    const lockedBody = JSON.parse(lockedRecorder.snapshot().body) as {
      locked: boolean;
      premiumPreviewUsername?: string;
    };

    expect(lockedBody.locked).toBe(true);
    expect(lockedBody.premiumPreviewUsername).toBe("premiumdemo");

    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "regularuser",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };
    const nonPremiumRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/analytics/overview?userId=${signupBody.userId}`,
      } as IncomingMessage,
      nonPremiumRecorder.response,
    );

    const nonPremiumBody = JSON.parse(nonPremiumRecorder.snapshot().body) as {
      locked: boolean;
      premiumAccess?: { isPremium: boolean; planName: string };
    };

    expect(nonPremiumBody.locked).toBe(true);
    expect(nonPremiumBody.premiumAccess).toMatchObject({
      isPremium: false,
      planName: "Free",
    });
  });

  it("returns mock analytics data for premium preview users", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "premiumdemo",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    const overviewRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/analytics/overview?userId=${signupBody.userId}`,
      } as IncomingMessage,
      overviewRecorder.response,
    );

    const overviewBody = JSON.parse(overviewRecorder.snapshot().body) as {
      locked: boolean;
      overview: {
        marketInsightCount: number;
        underpricedSignalCount: number;
        trackedBrands: number;
      };
      premiumAccess: { isPremium: boolean; planName: string };
      sampleData: boolean;
    };

    expect(overviewBody.locked).toBe(false);
    expect(overviewBody.sampleData).toBe(true);
    expect(overviewBody.premiumAccess).toMatchObject({
      isPremium: true,
      planName: "Collector Preview",
    });
    expect(overviewBody.overview.trackedBrands).toBeGreaterThan(0);
    expect(overviewBody.overview.marketInsightCount).toBeGreaterThan(0);

    const insightsRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/analytics/market-insights?userId=${signupBody.userId}`,
      } as IncomingMessage,
      insightsRecorder.response,
    );

    const insightsBody = JSON.parse(insightsRecorder.snapshot().body) as {
      insights: Array<{ id: string; title: string }>;
      locked: boolean;
    };

    expect(insightsBody.locked).toBe(false);
    expect(insightsBody.insights.length).toBeGreaterThan(0);

    const underpricedRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/analytics/underpriced?userId=${signupBody.userId}`,
      } as IncomingMessage,
      underpricedRecorder.response,
    );

    const underpricedBody = JSON.parse(underpricedRecorder.snapshot().body) as {
      locked: boolean;
      signals: Array<{ id: string; percentBelowMarket: number }>;
    };

    expect(underpricedBody.locked).toBe(false);
    expect(underpricedBody.signals.length).toBeGreaterThan(0);
    expect(underpricedBody.signals[0]?.percentBelowMarket).toBeGreaterThan(0);
  });

  it("personalizes the feed with onboarding preferences while keeping exploration", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "preflover",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    await handleRequest(
      createJsonRequest("POST", "/users/onboarding", {
        userId: signupBody.userId,
        preferences: {
          favoriteBrands: ["Acne Studios"],
          categories: ["knitwear"],
          priceRange: "$100-$300",
        },
      }),
      createResponseRecorder().response,
    );

    const feedRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/feed?page=1&pageSize=4&userId=${signupBody.userId}`,
      } as IncomingMessage,
      feedRecorder.response,
    );

    expect(feedRecorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(feedRecorder.snapshot().body) as {
      isPersonalized: boolean;
      listings: Array<{
        brand: { name: string };
        category?: string;
        title: string;
      }>;
    };

    expect(body.isPersonalized).toBe(true);
    expect(body.listings[0]).toMatchObject({
      brand: {
        name: "Acne Studios",
      },
      category: "knitwear",
    });
    expect(
      body.listings.slice(0, 3).some((listing) => listing.brand.name !== "Acne Studios"),
    ).toBe(true);
  });

  it("uses liked listings to influence future feed ranking", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "heartfirst",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    await handleRequest(
      {
        method: "GET",
        url: "/feed?page=1&pageSize=6",
      } as IncomingMessage,
      createResponseRecorder().response,
    );

    await handleRequest(
      createJsonRequest("POST", "/likes", {
        userId: signupBody.userId,
        listingId: "mock:mock-jacket-002",
        source: "mock",
      }),
      createResponseRecorder().response,
    );

    const feedRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/feed?page=1&pageSize=4&userId=${signupBody.userId}`,
      } as IncomingMessage,
      feedRecorder.response,
    );

    expect(feedRecorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(feedRecorder.snapshot().body) as {
      isPersonalized: boolean;
      listings: Array<{
        brand: { name: string };
        title: string;
      }>;
    };

    expect(body.isPersonalized).toBe(true);
    expect(body.listings[0]).toMatchObject({
      brand: {
        name: "Our Legacy",
      },
      title: "Our Legacy reversible coach jacket",
    });
  });

  it("falls back safely to the default feed when a signed-in user has no preference data yet", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "newuser",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    const feedRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: `/feed?page=1&pageSize=4&userId=${signupBody.userId}`,
      } as IncomingMessage,
      feedRecorder.response,
    );

    expect(feedRecorder.snapshot().statusCode).toBe(200);

    const body = JSON.parse(feedRecorder.snapshot().body) as {
      isPersonalized: boolean;
      listings: Array<{
        brand: { name: string };
      }>;
    };

    expect(body.isPersonalized).toBe(false);
    expect(body.listings[0]).toMatchObject({
      brand: {
        name: "Our Legacy",
      },
    });
  });
  it("persists recent searches through the API routes", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "searchhistory",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    const createRecentRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/recent-searches", {
        userId: signupBody.userId,
        label: "jacket",
        description: "Keyword search",
        params: "q=jacket",
      }),
      createRecentRecorder.response,
    );

    expect(createRecentRecorder.snapshot().statusCode).toBe(201);

    const listRecentRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: "/recent-searches/" + signupBody.userId,
      } as IncomingMessage,
      listRecentRecorder.response,
    );

    expect(JSON.parse(listRecentRecorder.snapshot().body)).toMatchObject({
      recentSearches: [
        {
          label: "jacket",
          params: "q=jacket",
        },
      ],
      userId: signupBody.userId,
    });

    const clearRecentRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "DELETE",
        url: "/recent-searches/" + signupBody.userId,
      } as IncomingMessage,
      clearRecentRecorder.response,
    );

    expect(JSON.parse(clearRecentRecorder.snapshot().body)).toEqual({
      cleared: true,
      userId: signupBody.userId,
    });
  });

  it("creates, lists, and deletes saved searches through the API routes", async () => {
    const signupRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "savedsearcher",
        password: "mohair",
      }),
      signupRecorder.response,
    );

    const signupBody = JSON.parse(signupRecorder.snapshot().body) as {
      userId: string;
    };

    const createSavedRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("POST", "/saved-searches", {
        userId: signupBody.userId,
        label: "Archive outerwear",
        description: "grailed • Price high to low",
        params: "q=archive+outerwear&source=grailed&sort=price_desc",
      }),
      createSavedRecorder.response,
    );

    expect(createSavedRecorder.snapshot().statusCode).toBe(201);

    const listSavedRecorder = createResponseRecorder();

    await handleRequest(
      {
        method: "GET",
        url: "/saved-searches/" + signupBody.userId,
      } as IncomingMessage,
      listSavedRecorder.response,
    );

    const listSavedBody = JSON.parse(listSavedRecorder.snapshot().body) as {
      savedSearches: Array<{ label: string; params: string }>;
    };

    expect(listSavedBody.savedSearches).toHaveLength(1);
    expect(listSavedBody.savedSearches[0]).toMatchObject({
      label: "Archive outerwear",
      params: "q=archive+outerwear&source=grailed&sort=price_desc",
    });

    const deleteSavedRecorder = createResponseRecorder();

    await handleRequest(
      createJsonRequest("DELETE", "/saved-searches", {
        userId: signupBody.userId,
        params: "q=archive+outerwear&source=grailed&sort=price_desc",
      }),
      deleteSavedRecorder.response,
    );

    expect(JSON.parse(deleteSavedRecorder.snapshot().body)).toEqual({
      removed: true,
    });
  });

});
