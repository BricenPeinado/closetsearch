import type { IncomingMessage } from "node:http";
import {
  findBrandBySlug,
  listBrands,
} from "../services/brandService.js";
import type { RouteResult } from "./route-result.js";

export function handleBrandRoute(
  request: IncomingMessage,
  requestUrl: URL,
): RouteResult | undefined {
  if ((request.method ?? "GET") !== "GET") {
    return undefined;
  }

  if (requestUrl.pathname === "/brands") {
    const query = requestUrl.searchParams.get("q")?.trim() || undefined;
    const brands = listBrands(query);

    return {
      body: {
        brands,
        query,
        total: brands.length,
      },
      kind: "json",
      statusCode: 200,
    };
  }

  if (!requestUrl.pathname.startsWith("/brands/")) {
    return undefined;
  }

  const brand = findBrandBySlug(
    decodeURIComponent(requestUrl.pathname.replace("/brands/", "")),
  );

  if (!brand) {
    return {
      body: {
        error: "not_found",
        message: "Brand not found.",
      },
      kind: "json",
      statusCode: 404,
    };
  }

  return {
    body: {
      brand,
    },
    kind: "json",
    statusCode: 200,
  };
}
