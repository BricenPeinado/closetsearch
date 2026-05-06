import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "./app.js";
import { resetLikeStore } from "./like-service.js";
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

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(4);
    expect(body.total).toBeGreaterThan(4);
    expect(body.hasMore).toBe(true);
    expect(body.nextPage).toBe(2);
    expect(body.listings).toHaveLength(4);
    expect(body.listings[0]).toMatchObject({
      providerId: "mock",
      source: {
        name: "Mock Closet",
      },
    });
    expect(body.listings[0].sourceUrl).toContain("https://");
  });
});
