import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { handleRequest } from "./app.js";

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

describe("handleRequest", () => {
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
