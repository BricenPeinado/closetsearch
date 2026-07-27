import type { IncomingMessage } from "node:http";
import { ApiError } from "../api-error.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import { ListingDetailService } from "../services/listingDetailService.js";
import type { RouteResult } from "./route-result.js";

function matchListingId(pathname: string) {
  const match = /^\/listings\/([^/]+)$/.exec(pathname);

  if (!match?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    throw new ApiError(400, "invalid_listing_id", "Listing ID is malformed.");
  }
}

export async function handleListingDetailRoute(
  request: IncomingMessage,
  requestUrl: URL,
): Promise<RouteResult | undefined> {
  const listingId = matchListingId(requestUrl.pathname);

  if ((request.method ?? "GET") !== "GET" || !listingId) {
    return undefined;
  }

  if (resolvePersistenceDriver() !== "postgres") {
    throw new ApiError(
      503,
      "listing_detail_unavailable",
      "Durable listing details require PostgreSQL.",
    );
  }

  const listing = await new ListingDetailService(await getPostgresDataPlane()).getListing(
    listingId,
  );

  if (!listing) {
    throw new ApiError(404, "listing_not_found", "Listing was not found.");
  }

  return {
    body: {
      listing,
    },
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=120",
    },
    kind: "json",
    statusCode: 200,
  };
}
