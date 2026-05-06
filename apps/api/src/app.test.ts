import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Brand } from "@closetsearch/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "./app.js";
import { resetLikeStore } from "./like-service.js";
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
  beforeEach(() => {
    resetUserStore();
    resetLikeStore();
    resetEngagementStore();
    resetListingCatalog();
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
        title: string;
      }>;
      query: { text: string };
      total: number;
    };

    expect(body.query.text).toBe("jacket");
    expect(body.total).toBeGreaterThan(0);
    expect(body.listings[0]).toMatchObject({
      providerId: "mock",
    });
    expect(body.listings.some((listing) => listing.title.toLowerCase().includes("jacket"))).toBe(
      true,
    );
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
      }>;
      page?: number;
      pageSize?: number;
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
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(24);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({
      listingType: "auction",
      providerId: "mock",
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
      hasMore: boolean;
      isPersonalized: boolean;
      listings: Array<{
        brand: { name: string };
        providerId: string;
        source: { name: string };
        sourceUrl: string;
        title: string;
      }>;
      nextPage?: number;
      page: number;
      pageSize: number;
      total: number;
    };

    expect(body.isPersonalized).toBe(false);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(4);
    expect(body.total).toBeGreaterThan(4);
    expect(body.hasMore).toBe(true);
    expect(body.nextPage).toBe(2);
    expect(body.listings).toHaveLength(4);
    expect(body.listings[0]).toMatchObject({
      brand: {
        name: "Our Legacy",
      },
      providerId: "mock",
      source: {
        name: "Mock Closet",
      },
    });
    expect(body.listings[0].sourceUrl).toContain("https://");
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
});
