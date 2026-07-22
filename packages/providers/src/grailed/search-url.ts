import type { ProviderSearchQuery } from "../types.js";

export interface GrailedSearchUrlOptions {
  baseUrl: string;
  page?: number;
  query: ProviderSearchQuery;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function buildGrailedSearchUrl(options: GrailedSearchUrlOptions) {
  const url = new URL("/shop", normalizeBaseUrl(options.baseUrl));
  const text = options.query.text.trim();

  if (text.length > 0) {
    url.searchParams.set("query", text);
  }

  const page = options.page ?? 1;

  if (page > 1) {
    url.searchParams.set("page", String(page));
  }

  return url.toString();
}
