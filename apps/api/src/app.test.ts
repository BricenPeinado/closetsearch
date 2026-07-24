import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Brand } from "@closetsearch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, getMetricRoute, resetHttpSecurityStateForTests } from "./app.js";
import { resetAuthSessionStore } from "./auth/session-service.js";
import { getDatabase } from "./db/database.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "./db/test-helpers.js";
import { resetLikeStore } from "./like-service.js";
import { resetRecentSearchStore } from "./recent-search-service.js";
import { resetSavedSearchStore } from "./saved-search-service.js";
import { resetSavedFilterStore } from "./saved-filter-service.js";
import { resetUserSettingsStore } from "./user-settings-service.js";
import { resetWatchlistStore } from "./watchlist-service.js";
import { resetListingCatalog } from "./services/listingCatalogService.js";
import {
  getObservedPriceSnapshots,
  resetPriceSnapshotStore,
} from "./services/priceSnapshotService.js";
import { resetUserStore } from "./user-service.js";

function createResponseRecorder() {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = "";
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const response = {
    end(chunk?: string) {
      body = chunk ?? "";
      resolveDone();
      return response;
    },
    writeHead(code: number, nextHeaders: Record<string, string>) {
      statusCode = code;
      headers = nextHeaders;
      return response;
    },
  } as unknown as ServerResponse<IncomingMessage>;

  return {
    done,
    response,
    snapshot: () => ({
      body,
      headers,
      statusCode,
    }),
  };
}

function createRequest(method: string, url: string, headers?: Record<string, string>) {
  const stream = Readable.from([]) as IncomingMessage;
  stream.headers = headers ?? {};
  stream.method = method;
  stream.url = url;
  return stream;
}

function createJsonRequest(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const json = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from(json ? [json] : []) as IncomingMessage;

  stream.headers = {
    ...(headers ?? {}),
    "content-type": "application/json",
  };
  stream.method = method;
  stream.url = url;

  return stream;
}

function createInvalidJsonRequest(
  method: string,
  url: string,
  body: string,
  headers?: Record<string, string>,
) {
  const stream = Readable.from([body]) as IncomingMessage;

  stream.headers = {
    ...(headers ?? {}),
    "content-type": "application/json",
  };
  stream.method = method;
  stream.url = url;

  return stream;
}

async function runRequest(request: IncomingMessage) {
  const recorder = createResponseRecorder();
  const app = createApp();
  const requestListener = app.listeners("request")[0] as (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ) => void;

  requestListener(request, recorder.response);
  await recorder.done;

  return recorder.snapshot();
}

async function signupAndGetSession(username: string, password = "closetpass") {
  const signupSnapshot = await runRequest(
    createJsonRequest("POST", "/auth/signup", {
      username,
      password,
    }),
  );

  expect(signupSnapshot.statusCode).toBe(201);
  expect(signupSnapshot.headers["set-cookie"]).toContain("HttpOnly");

  return {
    body: JSON.parse(signupSnapshot.body) as {
      user: { username: string };
      userId: string;
    },
    cookie: signupSnapshot.headers["set-cookie"],
    snapshot: signupSnapshot,
  };
}

const sampleLikedListing = {
  id: "mock:mock-jacket-001",
  providerId: "mock",
  providerListingId: "mock-jacket-001",
  source: {
    id: "mock",
    name: "Mock Closet",
  },
  sourceUrl: "https://mockcloset.example/listings/mock-jacket-001",
  title: "Mock Jacket",
  brand: {
    id: "brand:mock-label",
    slug: "mock-label",
    name: "Mock Label",
  },
  imageUrl: "https://cdn.example.com/mock-jacket.jpg",
  price: {
    amount: 200,
    currency: "USD",
  },
  listingType: "buy_now" as const,
  fetchedAt: "2026-07-10T12:00:00.000Z",
};

describe("HTTP metric route normalization", () => {
  it("keeps query values and resource identifiers out of metric labels", () => {
    expect(getMetricRoute("/search?text=secret-query")).toBe("/search");
    expect(getMetricRoute("/brands/kapital")).toBe("/brands/:slug");
    expect(getMetricRoute("/me/watchlists/private-watchlist-id")).toBe(
      "/me/watchlists/:watchlistId",
    );
    expect(getMetricRoute("/not-a-route/private-value")).toBe("unmatched");
  });
});

describe("handleRequest", () => {
  let databasePath = "";

  beforeEach(() => {
    resetHttpSecurityStateForTests();
    databasePath = useIsolatedDatabase("app");
    resetAuthSessionStore();
    resetUserStore();
    resetLikeStore();
    resetSavedFilterStore();
    resetWatchlistStore();
    resetUserSettingsStore();
    resetListingCatalog();
    resetPriceSnapshotStore();
    resetRecentSearchStore();
    resetSavedSearchStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("returns a healthy JSON response from /health with credential-safe CORS", async () => {
    const snapshot = await runRequest(
      createRequest("GET", "/health", {
        origin: "http://localhost:5173",
      }),
    );

    expect(snapshot).toMatchObject({
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": "http://localhost:5173",
        "content-type": "application/json; charset=utf-8",
      },
      statusCode: 200,
    });
    expect(snapshot.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(JSON.parse(snapshot.body)).toMatchObject({
      service: "closetsearch-api",
      status: "ok",
    });
  });

  it("validates the durable client-event boundary without counting server responses", async () => {
    const missingSession = await runRequest(
      createJsonRequest("POST", "/events", {
        eventId: "647613b8-5101-4ad4-87c5-c99fd45a3d5c",
        eventType: "listing_view",
        listingId: "mock:mock-jacket-001",
        occurredAt: new Date().toISOString(),
        viewportDurationMs: 1_000,
      }),
    );

    expect(missingSession.statusCode).toBe(400);
    expect(JSON.parse(missingSession.body)).toMatchObject({
      error: "invalid_privacy_session",
    });

    const sqliteCompatibilityMode = await runRequest(
      createJsonRequest(
        "POST",
        "/events",
        {
          eventId: "647613b8-5101-4ad4-87c5-c99fd45a3d5c",
          eventType: "listing_view",
          listingId: "mock:mock-jacket-001",
          occurredAt: new Date().toISOString(),
          viewportDurationMs: 1_000,
        },
        {
          "x-privacy-session-id": "opaque-test-session-123456",
        },
      ),
    );

    expect(sqliteCompatibilityMode.statusCode).toBe(503);
    expect(JSON.parse(sqliteCompatibilityMode.body)).toMatchObject({
      error: "durable_events_unavailable",
    });
  });

  it("returns a structured invalid_json error without echoing request secrets", async () => {
    const snapshot = await runRequest(
      createInvalidJsonRequest(
        "POST",
        "/auth/login",
        '{"username":"archivekid","password":"supersecret"',
      ),
    );

    expect(snapshot.statusCode).toBe(400);
    expect(snapshot.headers["x-request-id"]).toBeTruthy();
    expect(snapshot.body).not.toContain("supersecret");
    expect(JSON.parse(snapshot.body)).toEqual({
      error: "invalid_json",
      message: "The request body must be valid JSON.",
    });
  });

  it("returns provider health metadata without exposing secrets", async () => {
    const previousMode = process.env.PROVIDER_RUNTIME_MODE;
    const previousEnabled = process.env.GRAILED_PROVIDER_ENABLED;
    const previousScrapingAllowed = process.env.GRAILED_SCRAPING_ALLOWED;
    const previousAuthorizationReference = process.env.GRAILED_AUTHORIZATION_REFERENCE;
    const previousUserAgent = process.env.GRAILED_USER_AGENT;
    const previousBaseUrl = process.env.GRAILED_BASE_URL;

    process.env.PROVIDER_RUNTIME_MODE = "hybrid";
    process.env.GRAILED_PROVIDER_ENABLED = "true";
    process.env.GRAILED_SCRAPING_ALLOWED = "true";
    process.env.GRAILED_AUTHORIZATION_REFERENCE = "legal-approval-fixture-CS-123";
    process.env.GRAILED_USER_AGENT = "ClosetSearchBot/0.1 contact:team.com";
    process.env.GRAILED_BASE_URL = "https://secret-grailed.example/private";

    try {
      const snapshot = await runRequest(createRequest("GET", "/providers/health"));
      expect(snapshot.statusCode).toBe(200);

      const body = JSON.parse(snapshot.body) as {
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
          }),
        ]),
      );
      expect(snapshot.body).not.toContain("super-secret-key");
      expect(snapshot.body).not.toContain("ClosetSearchBot/0.1 contact:team.com");
      expect(snapshot.body).not.toContain("https://secret-grailed.example/private");
    } finally {
      if (previousMode === undefined) delete process.env.PROVIDER_RUNTIME_MODE;
      else process.env.PROVIDER_RUNTIME_MODE = previousMode;
      if (previousEnabled === undefined) delete process.env.GRAILED_PROVIDER_ENABLED;
      else process.env.GRAILED_PROVIDER_ENABLED = previousEnabled;
      if (previousScrapingAllowed === undefined) delete process.env.GRAILED_SCRAPING_ALLOWED;
      else process.env.GRAILED_SCRAPING_ALLOWED = previousScrapingAllowed;
      if (previousAuthorizationReference === undefined) {
        delete process.env.GRAILED_AUTHORIZATION_REFERENCE;
      } else {
        process.env.GRAILED_AUTHORIZATION_REFERENCE = previousAuthorizationReference;
      }
      if (previousUserAgent === undefined) delete process.env.GRAILED_USER_AGENT;
      else process.env.GRAILED_USER_AGENT = previousUserAgent;
      if (previousBaseUrl === undefined) delete process.env.GRAILED_BASE_URL;
      else process.env.GRAILED_BASE_URL = previousBaseUrl;
    }
  });

  it("creates a user, sets a session cookie, and returns only public user data", async () => {
    const signup = await signupAndGetSession("archivekid", "mohaircoat");

    expect(signup.body.userId).toBeTruthy();
    expect(signup.body.user.username).toBe("archivekid");
    expect(signup.snapshot.body).not.toContain("passwordHash");

    const meSnapshot = await runRequest(
      createRequest("GET", "/auth/me", {
        cookie: signup.cookie,
      }),
    );

    expect(meSnapshot.statusCode).toBe(200);
    expect(JSON.parse(meSnapshot.body)).toMatchObject({
      user: {
        username: "archivekid",
      },
      userId: signup.body.userId,
    });
  });

  it("rejects duplicate usernames with a structured auth error", async () => {
    await signupAndGetSession("archivekid", "mohaircoat");

    const snapshot = await runRequest(
      createJsonRequest("POST", "/auth/signup", {
        username: "archivekid",
        password: "differentpass",
      }),
    );

    expect(snapshot.statusCode).toBe(409);
    expect(JSON.parse(snapshot.body)).toMatchObject({
      error: "username_taken",
      message: "That username is already taken.",
    });
  });

  it("creates a new login session and rejects invalid credentials generically", async () => {
    await signupAndGetSession("archivekid", "mohaircoat");

    const loginSnapshot = await runRequest(
      createJsonRequest("POST", "/auth/login", {
        username: "archivekid",
        password: "mohaircoat",
      }),
    );

    expect(loginSnapshot.statusCode).toBe(200);
    expect(loginSnapshot.headers["set-cookie"]).toContain("HttpOnly");

    const invalidSnapshot = await runRequest(
      createJsonRequest("POST", "/auth/login", {
        username: "archivekid",
        password: "wrongpass",
      }),
    );

    expect(invalidSnapshot.statusCode).toBe(401);
    expect(JSON.parse(invalidSnapshot.body)).toMatchObject({
      error: "invalid_credentials",
      message: "Invalid username or password.",
    });
  });

  it("returns 401 from /auth/me without a cookie", async () => {
    const snapshot = await runRequest(createRequest("GET", "/auth/me"));

    expect(snapshot.statusCode).toBe(401);
    expect(JSON.parse(snapshot.body)).toMatchObject({
      error: "unauthenticated",
    });
  });

  it("logout revokes the session and clears the cookie", async () => {
    const signup = await signupAndGetSession("logoutdemo", "mohaircoat");

    const logoutSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/auth/logout",
        {},
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(logoutSnapshot.statusCode).toBe(200);
    expect(logoutSnapshot.headers["set-cookie"]).toContain("Max-Age=0");

    const meSnapshot = await runRequest(
      createRequest("GET", "/auth/me", {
        cookie: signup.cookie,
      }),
    );

    expect(meSnapshot.statusCode).toBe(401);
    expect(JSON.parse(meSnapshot.body)).toMatchObject({
      error: "session_expired",
    });
  });

  it("returns 401 for expired sessions and clears the stale cookie", async () => {
    const signup = await signupAndGetSession("expireddemo", "mohaircoat");

    getDatabase()
      .prepare("UPDATE auth_sessions SET expires_at = ?")
      .run("2000-01-01T00:00:00.000Z");

    const meSnapshot = await runRequest(
      createRequest("GET", "/auth/me", {
        cookie: signup.cookie,
      }),
    );

    expect(meSnapshot.statusCode).toBe(401);
    expect(meSnapshot.headers["set-cookie"]).toContain("Max-Age=0");
    expect(JSON.parse(meSnapshot.body)).toMatchObject({
      error: "session_expired",
    });
  });

  it("requires auth for onboarding and uses the authenticated user instead of a spoofed userId", async () => {
    const unauthenticatedSnapshot = await runRequest(
      createJsonRequest("POST", "/users/onboarding", {
        preferences: {
          favoriteBrands: ["Acne Studios"],
          categories: ["knitwear"],
          priceRange: "$100-$300",
        },
      }),
    );

    expect(unauthenticatedSnapshot.statusCode).toBe(401);

    const primary = await signupAndGetSession("preflover", "mohaircoat");
    const secondary = await signupAndGetSession("otheruser", "mohaircoat");

    const onboardingSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/users/onboarding",
        {
          userId: secondary.body.userId,
          preferences: {
            favoriteBrands: ["Acne Studios"],
            categories: ["knitwear"],
            priceRange: "$100-$300",
          },
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(onboardingSnapshot.statusCode).toBe(200);
    expect(JSON.parse(onboardingSnapshot.body)).toMatchObject({
      userId: primary.body.userId,
      user: {
        onboardingPreferences: {
          favoriteBrands: ["Acne Studios"],
          categories: ["knitwear"],
          priceRange: "$100-$300",
        },
      },
    });
  });

  it("requires auth for likes and ignores spoofed userId values", async () => {
    const primary = await signupAndGetSession("liker", "mohaircoat");
    const secondary = await signupAndGetSession("secondliker", "mohaircoat");

    const unauthenticatedSnapshot = await runRequest(
      createJsonRequest("POST", "/me/likes", {
        listingId: sampleLikedListing.id,
        source: sampleLikedListing.source.id,
      }),
    );

    expect(unauthenticatedSnapshot.statusCode).toBe(401);

    const createLikeSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/likes",
        {
          userId: secondary.body.userId,
          listingId: sampleLikedListing.id,
          source: sampleLikedListing.source.id,
          listing: sampleLikedListing,
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(createLikeSnapshot.statusCode).toBe(201);
    expect(JSON.parse(createLikeSnapshot.body)).toMatchObject({
      likedListing: {
        like: {
          listingId: sampleLikedListing.id,
          userId: primary.body.userId,
        },
        listing: {
          id: sampleLikedListing.id,
          title: sampleLikedListing.title,
        },
      },
      userId: primary.body.userId,
    });

    const primaryLikesSnapshot = await runRequest(
      createRequest("GET", "/me/likes", {
        cookie: primary.cookie,
      }),
    );

    expect(JSON.parse(primaryLikesSnapshot.body)).toMatchObject({
      likedListings: [
        {
          like: {
            listingId: sampleLikedListing.id,
            userId: primary.body.userId,
          },
          listing: {
            id: sampleLikedListing.id,
            title: sampleLikedListing.title,
          },
        },
      ],
      likes: [
        {
          listingId: sampleLikedListing.id,
          userId: primary.body.userId,
        },
      ],
      userId: primary.body.userId,
    });

    const secondaryLikesSnapshot = await runRequest(
      createRequest("GET", "/me/likes", {
        cookie: secondary.cookie,
      }),
    );

    expect(JSON.parse(secondaryLikesSnapshot.body)).toMatchObject({
      likedListings: [],
      likes: [],
      userId: secondary.body.userId,
    });
  });

  it("dedupes duplicate likes and deletes likes by listing id", async () => {
    const signup = await signupAndGetSession("dupeliker", "mohaircoat");

    const firstSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/likes",
        {
          listingId: sampleLikedListing.id,
          source: sampleLikedListing.source.id,
          listing: sampleLikedListing,
        },
        {
          cookie: signup.cookie,
        },
      ),
    );
    const secondSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/likes",
        {
          listingId: sampleLikedListing.id,
          source: sampleLikedListing.source.id,
          listing: sampleLikedListing,
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(firstSnapshot.statusCode).toBe(201);
    expect(secondSnapshot.statusCode).toBe(201);

    const firstBody = JSON.parse(firstSnapshot.body) as {
      likedListing: { like: { id: string } };
    };
    const secondBody = JSON.parse(secondSnapshot.body) as {
      likedListing: { like: { id: string } };
    };

    expect(secondBody.likedListing.like.id).toBe(firstBody.likedListing.like.id);

    const deleteSnapshot = await runRequest(
      createJsonRequest(
        "DELETE",
        "/me/likes",
        {
          listingId: sampleLikedListing.id,
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(JSON.parse(deleteSnapshot.body)).toEqual({
      removed: true,
      userId: signup.body.userId,
    });
  });

  it("returns normalized fixture search results without using mock data for analytics", async () => {
    const snapshot = await runRequest(createRequest("GET", "/search?q=jacket"));

    expect(snapshot.statusCode).toBe(200);

    const body = JSON.parse(snapshot.body) as {
      listings: Array<{
        providerId: string;
        riskSignal?: { riskLevel: string };
        title: string;
      }>;
      pagination: {
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
    expect(getObservedPriceSnapshots()).toHaveLength(0);
  });

  it("returns paginated normalized feed results and personalizes them from the session cookie", async () => {
    const signedOutSnapshot = await runRequest(createRequest("GET", "/feed?page=1&pageSize=4"));

    expect(signedOutSnapshot.statusCode).toBe(200);
    expect(JSON.parse(signedOutSnapshot.body)).toMatchObject({
      isPersonalized: false,
      pagination: {
        page: 1,
        pageSize: 4,
      },
    });
    expect(getObservedPriceSnapshots()).toHaveLength(0);

    const signup = await signupAndGetSession("preflover", "mohaircoat");

    await runRequest(
      createJsonRequest(
        "POST",
        "/users/onboarding",
        {
          preferences: {
            favoriteBrands: ["Acne Studios"],
            categories: ["knitwear"],
            priceRange: "$100-$300",
          },
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    const personalizedSnapshot = await runRequest(
      createRequest("GET", "/feed?page=1&pageSize=4&debugPersonalization=1", {
        cookie: signup.cookie,
      }),
    );

    const body = JSON.parse(personalizedSnapshot.body) as {
      debugPersonalization?: {
        scoreBreakdowns: Array<{ listingId: string; reasons: Array<{ code: string }> }>;
      };
      isPersonalized: boolean;
      listings: Array<{ brand: { name: string }; category?: string; id: string }>;
      personalizationSummary?: { isPersonalized: boolean; message: string; signalLabels: string[] };
    };

    expect(body.isPersonalized).toBe(true);
    expect(body.personalizationSummary).toMatchObject({
      isPersonalized: true,
      signalLabels: expect.arrayContaining(["onboarding preferences"]),
    });
    expect(body.listings[0]).toMatchObject({
      brand: { name: "Acne Studios" },
      category: "knitwear",
    });
    expect(body.debugPersonalization?.scoreBreakdowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listingId: body.listings[0]?.id,
          reasons: expect.arrayContaining([expect.objectContaining({ code: "brand_affinity" })]),
        }),
      ]),
    );
  });

  it("lists brands and returns individual brand detail responses", async () => {
    const listSnapshot = await runRequest(createRequest("GET", "/brands?q=streetwear"));
    const listBody = JSON.parse(listSnapshot.body) as {
      brands: Brand[];
      total: number;
    };

    expect(listSnapshot.statusCode).toBe(200);
    expect(listBody.total).toBeGreaterThan(0);
    expect(listBody.brands.some((brand) => brand.name === "Supreme")).toBe(true);

    const detailSnapshot = await runRequest(createRequest("GET", "/brands/kapital"));
    expect(detailSnapshot.statusCode).toBe(200);
    expect(JSON.parse(detailSnapshot.body)).toMatchObject({
      brand: {
        slug: "kapital",
        name: "Kapital",
      },
    });
  });

  it("keeps analytics locked without a persisted entitlement, regardless of username", async () => {
    const lockedSnapshot = await runRequest(createRequest("GET", "/analytics/overview"));
    const signedOutBody = JSON.parse(lockedSnapshot.body) as Record<string, unknown>;

    expect(signedOutBody).toMatchObject({
      locked: true,
      message: expect.stringContaining("persisted entitlement"),
    });
    expect(signedOutBody).not.toHaveProperty("premiumPreviewUsername");

    const usernameOnly = await signupAndGetSession("premiumdemo", "mohaircoat");
    const signedInSnapshot = await runRequest(
      createRequest("GET", "/analytics/overview", {
        cookie: usernameOnly.cookie,
      }),
    );
    const signedInBody = JSON.parse(signedInSnapshot.body) as Record<string, unknown>;

    expect(signedInBody).toMatchObject({
      locked: true,
      premiumAccess: {
        isPremium: false,
        planName: "Free",
        userId: usernameOnly.body.userId,
      },
    });
    expect(signedInBody).not.toHaveProperty("overview");
  });

  it("persists recent searches through authenticated API routes", async () => {
    const signup = await signupAndGetSession("searchhistory", "mohaircoat");

    const createSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/recent-searches",
        {
          label: "jacket",
          description: "Keyword search",
          params: "q=jacket",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(createSnapshot.statusCode).toBe(201);

    const listSnapshot = await runRequest(
      createRequest("GET", "/recent-searches", {
        cookie: signup.cookie,
      }),
    );

    expect(JSON.parse(listSnapshot.body)).toMatchObject({
      recentSearches: [
        {
          label: "jacket",
          params: "q=jacket",
        },
      ],
      userId: signup.body.userId,
    });

    const clearSnapshot = await runRequest(
      createJsonRequest(
        "DELETE",
        "/recent-searches",
        {},
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(JSON.parse(clearSnapshot.body)).toEqual({
      cleared: true,
      userId: signup.body.userId,
    });
  });

  it("creates, lists, and deletes saved searches through authenticated API routes", async () => {
    const signup = await signupAndGetSession("savedsearcher", "mohaircoat");

    const createSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/saved-searches",
        {
          label: "Archive outerwear",
          description: "grailed • Price high to low",
          params: "q=archive+outerwear&source=grailed&sort=price_desc",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(createSnapshot.statusCode).toBe(201);

    const listSnapshot = await runRequest(
      createRequest("GET", "/me/saved-searches", {
        cookie: signup.cookie,
      }),
    );

    expect(JSON.parse(listSnapshot.body)).toMatchObject({
      savedSearches: [
        {
          label: "Archive outerwear",
          params: "q=archive+outerwear&source=grailed&sort=price_desc",
        },
      ],
      userId: signup.body.userId,
    });

    const deleteSnapshot = await runRequest(
      createJsonRequest(
        "DELETE",
        "/me/saved-searches",
        {
          params: "q=archive+outerwear&source=grailed&sort=price_desc",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(JSON.parse(deleteSnapshot.body)).toEqual({
      removed: true,
      userId: signup.body.userId,
    });
  });

  it("creates, lists, and deletes saved filters through authenticated API routes", async () => {
    const signup = await signupAndGetSession("savedfilterer", "mohaircoat");

    const createSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/saved-filters",
        {
          userId: "spoofed",
          label: "Kapital preset",
          queryText: "kapital",
          source: "grailed",
          minPrice: 120,
          maxPrice: 260,
          sortMode: "newest",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(createSnapshot.statusCode).toBe(201);
    const createBody = JSON.parse(createSnapshot.body) as {
      savedFilter: { id: string; userId: string };
      userId: string;
    };
    expect(createBody.savedFilter.userId).toBe(signup.body.userId);
    expect(createBody.userId).toBe(signup.body.userId);

    const listSnapshot = await runRequest(
      createRequest("GET", "/me/saved-filters", {
        cookie: signup.cookie,
      }),
    );

    expect(JSON.parse(listSnapshot.body)).toMatchObject({
      savedFilters: [
        {
          label: "Kapital preset",
          source: "grailed",
        },
      ],
      userId: signup.body.userId,
    });

    const deleteSnapshot = await runRequest(
      createJsonRequest(
        "DELETE",
        "/me/saved-filters",
        {
          id: createBody.savedFilter.id,
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(JSON.parse(deleteSnapshot.body)).toEqual({
      removed: true,
      userId: signup.body.userId,
    });
  });

  it("creates, lists, and deletes watchlist shell items", async () => {
    const signup = await signupAndGetSession("watchlister", "mohaircoat");

    const createSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/watchlists",
        {
          label: "Kapital under $250",
          queryText: "kapital",
          brand: "Kapital",
          maxPrice: 250,
          source: "grailed",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(createSnapshot.statusCode).toBe(201);
    const createBody = JSON.parse(createSnapshot.body) as {
      watchlist: { id: string };
      userId: string;
    };

    const listSnapshot = await runRequest(
      createRequest("GET", "/me/watchlists", {
        cookie: signup.cookie,
      }),
    );

    expect(JSON.parse(listSnapshot.body)).toMatchObject({
      watchlists: [
        {
          label: "Kapital under $250",
          brand: "Kapital",
          source: "grailed",
        },
      ],
      userId: signup.body.userId,
    });

    const deleteSnapshot = await runRequest(
      createJsonRequest(
        "DELETE",
        "/me/watchlists",
        {
          id: createBody.watchlist.id,
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(JSON.parse(deleteSnapshot.body)).toEqual({
      removed: true,
      userId: signup.body.userId,
    });
  });

  it("updates watchlists, validates criteria, and keeps them scoped to the authenticated user", async () => {
    const primary = await signupAndGetSession("watchupdate", "mohaircoat");
    const secondary = await signupAndGetSession("watchother", "mohaircoat");

    const createSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/watchlists",
        {
          userId: secondary.body.userId,
          brand: "Rick Owens",
          maxPriceAmount: 300,
          priceCurrency: "USD",
          source: "grailed",
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(createSnapshot.statusCode).toBe(201);
    const createBody = JSON.parse(createSnapshot.body) as {
      watchlist: {
        brand: string;
        enabled: boolean;
        id: string;
        label: string;
        userId: string;
      };
      userId: string;
    };

    expect(createBody.watchlist).toMatchObject({
      brand: "Rick Owens",
      enabled: true,
      label: "Rick Owens under $300",
      userId: primary.body.userId,
    });
    expect(createBody.userId).toBe(primary.body.userId);

    const updateSnapshot = await runRequest(
      createJsonRequest(
        "PATCH",
        "/me/watchlists/" + createBody.watchlist.id,
        {
          category: "jackets",
          enabled: false,
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(updateSnapshot.statusCode).toBe(200);
    expect(JSON.parse(updateSnapshot.body)).toMatchObject({
      watchlist: {
        brand: "Rick Owens",
        category: "jackets",
        enabled: false,
      },
      userId: primary.body.userId,
    });

    const secondaryListSnapshot = await runRequest(
      createRequest("GET", "/me/watchlists", {
        cookie: secondary.cookie,
      }),
    );

    expect(JSON.parse(secondaryListSnapshot.body)).toMatchObject({
      watchlists: [],
      userId: secondary.body.userId,
    });

    const spoofedPatchSnapshot = await runRequest(
      createJsonRequest(
        "PATCH",
        "/me/watchlists/" + createBody.watchlist.id,
        {
          label: "Spoofed update",
        },
        {
          cookie: secondary.cookie,
        },
      ),
    );

    expect(spoofedPatchSnapshot.statusCode).toBe(404);
    expect(JSON.parse(spoofedPatchSnapshot.body)).toMatchObject({
      error: "watchlist_not_found",
      message: "Watchlist not found.",
    });

    const invalidCriteriaSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/watchlists",
        {
          label: "Empty watchlist",
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(invalidCriteriaSnapshot.statusCode).toBe(400);
    expect(JSON.parse(invalidCriteriaSnapshot.body)).toMatchObject({
      error: "invalid_request",
      message:
        "Add at least one watch criterion like a brand, query, category, source, size, condition, or price range.",
    });

    const invalidPriceSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/me/watchlists",
        {
          brand: "Kapital",
          minPriceAmount: 500,
          maxPriceAmount: 250,
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(invalidPriceSnapshot.statusCode).toBe(400);
    expect(JSON.parse(invalidPriceSnapshot.body)).toMatchObject({
      error: "invalid_request",
      message: "Max price cannot be lower than min price.",
    });
  });

  it("returns default notification preferences, persists updates, and exposes empty alert matches honestly", async () => {
    const signup = await signupAndGetSession("watchprefs", "mohaircoat");

    const defaultSnapshot = await runRequest(
      createRequest("GET", "/me/notification-preferences", {
        cookie: signup.cookie,
      }),
    );

    expect(defaultSnapshot.statusCode).toBe(200);
    expect(JSON.parse(defaultSnapshot.body)).toMatchObject({
      notificationPreferences: {
        emailEnabled: false,
        frequency: "daily",
        inAppEnabled: true,
        pushEnabled: false,
        smsEnabled: false,
        userId: signup.body.userId,
      },
      userId: signup.body.userId,
    });

    const patchSnapshot = await runRequest(
      createJsonRequest(
        "PATCH",
        "/me/notification-preferences",
        {
          userId: "spoofed",
          emailEnabled: true,
          pushEnabled: true,
          smsEnabled: true,
          inAppEnabled: false,
          frequency: "weekly",
          quietHoursStart: "22:00",
          quietHoursEnd: "08:00",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(patchSnapshot.statusCode).toBe(200);
    expect(JSON.parse(patchSnapshot.body)).toMatchObject({
      notificationPreferences: {
        emailEnabled: true,
        frequency: "weekly",
        inAppEnabled: false,
        pushEnabled: true,
        quietHoursEnd: "08:00",
        quietHoursStart: "22:00",
        smsEnabled: true,
        userId: signup.body.userId,
      },
      userId: signup.body.userId,
    });

    const persistedSnapshot = await runRequest(
      createRequest("GET", "/me/notification-preferences", {
        cookie: signup.cookie,
      }),
    );

    expect(JSON.parse(persistedSnapshot.body)).toMatchObject({
      notificationPreferences: {
        emailEnabled: true,
        frequency: "weekly",
        inAppEnabled: false,
        pushEnabled: true,
        quietHoursEnd: "08:00",
        quietHoursStart: "22:00",
        smsEnabled: true,
      },
    });

    const alertMatchesSnapshot = await runRequest(
      createRequest("GET", "/me/alert-matches", {
        cookie: signup.cookie,
      }),
    );

    expect(alertMatchesSnapshot.statusCode).toBe(200);
    expect(JSON.parse(alertMatchesSnapshot.body)).toMatchObject({
      alertMatches: [],
      deliveryActive: false,
      message:
        "SQLite compatibility mode does not run worker matching. In-app alerts are available with PostgreSQL; outbound email, push, and SMS remain disabled.",
      userId: signup.body.userId,
    });

    const invalidQuietHoursSnapshot = await runRequest(
      createJsonRequest(
        "PATCH",
        "/me/notification-preferences",
        {
          quietHoursStart: "25:99",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(invalidQuietHoursSnapshot.statusCode).toBe(400);
    expect(JSON.parse(invalidQuietHoursSnapshot.body)).toMatchObject({
      error: "invalid_request",
      message: "quietHoursStart must use HH:MM 24-hour time.",
    });
  });

  it("gets and patches authenticated user settings", async () => {
    const signup = await signupAndGetSession("settingsuser", "mohaircoat");

    const initialSnapshot = await runRequest(
      createRequest("GET", "/me/settings", {
        cookie: signup.cookie,
      }),
    );

    expect(JSON.parse(initialSnapshot.body)).toMatchObject({
      settings: {
        preferredCurrency: "USD",
        preferredSources: [],
      },
      userId: signup.body.userId,
    });

    const patchSnapshot = await runRequest(
      createJsonRequest(
        "PATCH",
        "/me/settings",
        {
          userId: "spoofed",
          preferredCurrency: "EUR",
          defaultSortMode: "newest",
          preferredSources: ["grailed", "mock"],
          displayName: "Archive Hunter",
        },
        {
          cookie: signup.cookie,
        },
      ),
    );

    expect(JSON.parse(patchSnapshot.body)).toMatchObject({
      settings: {
        userId: signup.body.userId,
        preferredCurrency: "EUR",
        defaultSortMode: "newest",
        preferredSources: ["grailed", "mock"],
        displayName: "Archive Hunter",
      },
      userId: signup.body.userId,
    });
  });

  it("rejects unauthenticated saved-user routes", async () => {
    const routes = [
      createRequest("GET", "/me/likes"),
      createRequest("GET", "/me/saved-searches"),
      createRequest("GET", "/me/saved-filters"),
      createRequest("GET", "/me/watchlists"),
      createRequest("GET", "/me/notification-preferences"),
      createRequest("GET", "/me/alert-matches"),
      createRequest("GET", "/me/settings"),
      createJsonRequest("POST", "/me/watchlists", {
        brand: "Kapital",
      }),
    ];

    for (const request of routes) {
      const snapshot = await runRequest(request);
      expect(snapshot.statusCode).toBe(401);
    }
  });
});
