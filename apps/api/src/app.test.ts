import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Brand } from "@closetsearch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { resetAuthSessionStore } from "./auth/session-service.js";
import { getDatabase } from "./db/database.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "./db/test-helpers.js";
import { resetLikeStore } from "./like-service.js";
import { resetRecentSearchStore } from "./recent-search-service.js";
import { resetSavedSearchStore } from "./saved-search-service.js";
import { resetEngagementStore } from "./services/engagementService.js";
import { resetListingCatalog } from "./services/listingCatalogService.js";
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

describe("handleRequest", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("app");
    resetAuthSessionStore();
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

    expect(JSON.parse(snapshot.body)).toMatchObject({
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
      createJsonRequest("POST", "/auth/logout", {}, {
        cookie: signup.cookie,
      }),
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
      createJsonRequest("POST", "/likes", {
        listingId: "mock:mock-jacket-001",
        source: "mock",
      }),
    );

    expect(unauthenticatedSnapshot.statusCode).toBe(401);

    const createLikeSnapshot = await runRequest(
      createJsonRequest(
        "POST",
        "/likes",
        {
          userId: secondary.body.userId,
          listingId: "mock:mock-jacket-001",
          source: "mock",
        },
        {
          cookie: primary.cookie,
        },
      ),
    );

    expect(createLikeSnapshot.statusCode).toBe(201);
    expect(JSON.parse(createLikeSnapshot.body)).toMatchObject({
      like: {
        listingId: "mock:mock-jacket-001",
        userId: primary.body.userId,
      },
    });

    const primaryLikesSnapshot = await runRequest(
      createRequest("GET", "/likes", {
        cookie: primary.cookie,
      }),
    );

    expect(JSON.parse(primaryLikesSnapshot.body)).toMatchObject({
      likes: [
        {
          listingId: "mock:mock-jacket-001",
          userId: primary.body.userId,
        },
      ],
      userId: primary.body.userId,
    });

    const secondaryLikesSnapshot = await runRequest(
      createRequest("GET", "/likes", {
        cookie: secondary.cookie,
      }),
    );

    expect(JSON.parse(secondaryLikesSnapshot.body)).toMatchObject({
      likes: [],
      userId: secondary.body.userId,
    });
  });

  it("returns normalized search results from /search", async () => {
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
      createRequest("GET", "/feed?page=1&pageSize=4", {
        cookie: signup.cookie,
      }),
    );

    const body = JSON.parse(personalizedSnapshot.body) as {
      isPersonalized: boolean;
      listings: Array<{ brand: { name: string }; category?: string }>;
    };

    expect(body.isPersonalized).toBe(true);
    expect(body.listings[0]).toMatchObject({
      brand: { name: "Acne Studios" },
      category: "knitwear",
    });
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

  it("uses the authenticated session for premium analytics access", async () => {
    const lockedSnapshot = await runRequest(createRequest("GET", "/analytics/overview"));
    expect(JSON.parse(lockedSnapshot.body)).toMatchObject({
      locked: true,
    });

    const premium = await signupAndGetSession("premiumdemo", "mohaircoat");

    const overviewSnapshot = await runRequest(
      createRequest("GET", "/analytics/overview", {
        cookie: premium.cookie,
      }),
    );

    expect(JSON.parse(overviewSnapshot.body)).toMatchObject({
      locked: false,
      premiumAccess: {
        isPremium: true,
        planName: "Collector Preview",
      },
    });
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
      createJsonRequest("DELETE", "/recent-searches", {}, {
        cookie: signup.cookie,
      }),
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
        "/saved-searches",
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
      createRequest("GET", "/saved-searches", {
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
        "/saved-searches",
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
    });
  });
});
