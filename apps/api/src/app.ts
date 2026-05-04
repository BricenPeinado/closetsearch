import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { FeedQuery, SearchQuery } from "@closetsearch/shared";
import { getFeed } from "./feed-service.js";
import { searchListings } from "./search-service.js";

function sendJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
) {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function parseListParameter(value: string | null) {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseSearchQuery(requestUrl: URL): SearchQuery | null {
  const text = requestUrl.searchParams.get("q")?.trim() ?? "";

  if (text.length === 0) {
    return null;
  }

  const minPrice = requestUrl.searchParams.get("minPrice");
  const maxPrice = requestUrl.searchParams.get("maxPrice");
  const parsedMinPrice = minPrice ? Number(minPrice) : undefined;
  const parsedMaxPrice = maxPrice ? Number(maxPrice) : undefined;

  return {
    text,
    brandSlugs: parseListParameter(requestUrl.searchParams.get("brands")),
    categories: parseListParameter(requestUrl.searchParams.get("categories")),
    sizes: parseListParameter(requestUrl.searchParams.get("sizes")),
    sourceIds: parseListParameter(requestUrl.searchParams.get("sources")),
    sort:
      (requestUrl.searchParams.get("sort") as SearchQuery["sort"] | null) ??
      "relevance",
    currency: requestUrl.searchParams.get("currency") ?? undefined,
    price:
      parsedMinPrice !== undefined || parsedMaxPrice !== undefined
        ? {
            min: Number.isFinite(parsedMinPrice) ? parsedMinPrice : undefined,
            max: Number.isFinite(parsedMaxPrice) ? parsedMaxPrice : undefined,
            currency: requestUrl.searchParams.get("currency") ?? undefined,
          }
        : undefined,
  };
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

function parseFeedQuery(requestUrl: URL): FeedQuery {
  const page = parsePositiveInteger(requestUrl.searchParams.get("page"), 1);
  const requestedPageSize = parsePositiveInteger(
    requestUrl.searchParams.get("pageSize"),
    12,
  );

  return {
    page,
    pageSize: Math.min(requestedPageSize, 24),
  };
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      service: "closetsearch-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/search") {
    const query = parseSearchQuery(requestUrl);

    if (!query) {
      sendJson(response, 400, {
        error: "invalid_query",
        message: 'The "q" query parameter is required.',
      });
      return;
    }

    const result = await searchListings(query);

    sendJson(response, 200, result);
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/feed") {
    const result = await getFeed(parseFeedQuery(requestUrl));

    sendJson(response, 200, result);
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: "Route not found in the Milestone 4 API boundary.",
  });
}

export function createApp() {
  return createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      console.error("Unhandled API error", error);

      sendJson(response, 500, {
        error: "internal_error",
        message: "The API could not complete the request.",
      });
    });
  });
}
