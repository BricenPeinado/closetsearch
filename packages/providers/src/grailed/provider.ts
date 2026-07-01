import type { SearchSortMode } from "@closetsearch/shared";
import type {
  Provider,
  ProviderCapabilities,
  ProviderFailureCode,
  ProviderPagination,
  ProviderSearchFailure,
  ProviderSearchQuery,
  ProviderSearchRequest,
  ProviderSearchResponse,
  ProviderSearchResult,
  ProviderWarning,
} from "../types";
import {
  grailedFixtureListings,
  type RawGrailedFixtureListing,
} from "./fixtures";
import { createGrailedHttpClient, type GrailedFetch } from "./http-client";
import {
  createGrailedListingInputFromFixture,
  createGrailedListingInputFromParsedCard,
  normalizeGrailedListing,
} from "./normalizer";
import { hasGrailedNoResultsState, parseGrailedListingCards } from "./parser";
import { buildGrailedSearchUrl } from "./search-url";

const GRAILED_PROVIDER_ID = "grailed";
const GRAILED_PROVIDER_NAME = "Grailed";
const defaultBaseUrl = "https://www.grailed.com";
const defaultUserAgent = "ClosetSearchBot/0.1 contact:<project-contact-email>";
const defaultRequestTimeoutMs = 5_000;
const defaultMinRequestIntervalMs = 3_000;
const defaultMaxResultsPerSearch = 24;

export type GrailedProviderRuntimeMode = "fixture" | "authorized-live";

export interface GrailedProviderOptions {
  baseUrl?: string;
  fetchImpl?: GrailedFetch;
  fixtureListings?: RawGrailedFixtureListing[];
  maxResultsPerSearch?: number;
  minRequestIntervalMs?: number;
  nowImpl?: () => number;
  requestTimeoutMs?: number;
  runtimeMode?: GrailedProviderRuntimeMode;
  scrapingAllowed?: boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  userAgent?: string;
}

const grailedCapabilities: ProviderCapabilities = {
  supportsPagination: true,
  supportsPagePagination: true,
  supportsCursorPagination: false,
  supportsPriceRange: false,
  supportedListingTypes: ["auction", "buy_now", "unknown"],
  supportedSortModes: ["relevance", "newest"],
};

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createFailure(
  code: ProviderFailureCode,
  message: string,
  retryable = false,
): ProviderSearchFailure {
  return {
    providerId: GRAILED_PROVIDER_ID,
    status: "failure",
    failure: {
      providerId: GRAILED_PROVIDER_ID,
      code,
      message,
      retryable,
    },
  };
}

function createSuccess(
  listings: ProviderSearchResult["listings"],
  pagination: ProviderPagination,
  warnings?: ProviderWarning[],
): ProviderSearchResult {
  return {
    providerId: GRAILED_PROVIDER_ID,
    status: "success",
    listings,
    pagination,
    warnings,
    metadata: {
      providerId: GRAILED_PROVIDER_ID,
      fetchedAt: new Date().toISOString(),
      resultCount: listings.length,
      pagination,
    },
  } satisfies ProviderSearchResult;
}

function toSearchTerms(text: string) {
  return text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizePage(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.trunc(value);
}

function getFixtureResultLimit(
  pagination: ProviderSearchRequest["pagination"],
  maxResultsPerSearch: number,
) {
  const requestedPageSize = pagination?.pageSize;

  if (typeof requestedPageSize !== "number" || !Number.isFinite(requestedPageSize)) {
    return maxResultsPerSearch;
  }

  return Math.max(1, Math.min(maxResultsPerSearch, Math.trunc(requestedPageSize)));
}

function getLiveResultLimit(maxResultsPerSearch: number) {
  return Math.max(1, Math.trunc(maxResultsPerSearch));
}

function matchesFixtureQuery(raw: RawGrailedFixtureListing, query: ProviderSearchQuery) {
  const listing = normalizeGrailedListing(createGrailedListingInputFromFixture(raw));

  if (query.sourceIds?.length && !query.sourceIds.includes(GRAILED_PROVIDER_ID)) {
    return false;
  }

  const terms = toSearchTerms(query.text);

  if (terms.length > 0) {
    const haystack = [
      raw.title,
      raw.brandName ?? "",
      raw.category ?? "",
      raw.size ?? "",
    ]
      .join(" ")
      .toLowerCase();

    if (!terms.every((term) => haystack.includes(term))) {
      return false;
    }
  }

  if (query.brandSlugs?.length && !query.brandSlugs.includes(toTrimmedString(raw.brandSlug))) {
    return false;
  }

  if (query.categories?.length && (!raw.category || !query.categories.includes(raw.category))) {
    return false;
  }

  if (query.sizes?.length && (!raw.size || !query.sizes.includes(raw.size))) {
    return false;
  }

  if (
    query.conditions?.length &&
    (!listing.condition || !query.conditions.includes(listing.condition))
  ) {
    return false;
  }

  if (
    query.listingTypes?.length &&
    !query.listingTypes.includes(listing.listingType)
  ) {
    return false;
  }

  return true;
}

function sortFixtureListings(
  listings: RawGrailedFixtureListing[],
  sortMode: SearchSortMode = "relevance",
) {
  const sorted = [...listings];

  if (sortMode === "newest" || sortMode === "relevance") {
    sorted.sort(
      (left, right) =>
        new Date(right.publishedAt ?? 0).valueOf() -
        new Date(left.publishedAt ?? 0).valueOf(),
    );
  }

  return sorted;
}

async function searchFixtureListings(
  fixtureListings: RawGrailedFixtureListing[],
  request: ProviderSearchRequest,
  maxResultsPerSearch: number,
): Promise<ProviderSearchResult> {
  const page = normalizePage(request.pagination?.page);
  const pageSize = getFixtureResultLimit(request.pagination, maxResultsPerSearch);
  const matchedListings = sortFixtureListings(
    fixtureListings.filter((listing) => matchesFixtureQuery(listing, request.query)),
    request.query.sort,
  ).map((listing) => normalizeGrailedListing(createGrailedListingInputFromFixture(listing)));
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const listings = matchedListings.slice(startIndex, endIndex);
  const hasMore = endIndex < matchedListings.length;

  return createSuccess(listings, {
    page,
    pageSize,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
    totalCount: matchedListings.length,
  });
}

async function searchAuthorizedLiveListings(
  request: ProviderSearchRequest,
  options: Required<
    Pick<
      GrailedProviderOptions,
      | "baseUrl"
      | "fetchImpl"
      | "maxResultsPerSearch"
      | "minRequestIntervalMs"
      | "requestTimeoutMs"
      | "scrapingAllowed"
      | "userAgent"
    >
  > & {
    nowImpl?: () => number;
    sleepImpl?: (ms: number) => Promise<void>;
  },
): Promise<ProviderSearchResponse> {
  if (!options.scrapingAllowed) {
    return createFailure(
      "authorization_required",
      "Grailed scraping is not allowed until GRAILED_SCRAPING_ALLOWED=true is set with documented written permission.",
    );
  }

  const client = createGrailedHttpClient({
    fetchImpl: options.fetchImpl,
    minRequestIntervalMs: options.minRequestIntervalMs,
    requestTimeoutMs: options.requestTimeoutMs,
    userAgent: options.userAgent,
    nowImpl: options.nowImpl,
    sleepImpl: options.sleepImpl,
  });
  const page = normalizePage(request.pagination?.page);
  const pageSize = getLiveResultLimit(options.maxResultsPerSearch);

  try {
    const response = await client.getHtml(
      buildGrailedSearchUrl({
        baseUrl: options.baseUrl,
        page,
        query: request.query,
      }),
    );

    if (response.status === 429) {
      return createFailure(
        "rate_limited",
        "Grailed returned a rate-limit response. Back off before retrying.",
        true,
      );
    }

    if (!response.ok) {
      return createFailure(
        "unavailable",
        "Grailed scraping request failed with status " + response.status + ".",
        response.status >= 500,
      );
    }

    const parsedCards = parseGrailedListingCards(response.body);

    if (parsedCards.length === 0) {
      if (hasGrailedNoResultsState(response.body)) {
        return createSuccess([], {
          page,
          pageSize,
          hasMore: false,
          totalCount: 0,
        });
      }

      return createFailure(
        "normalization_failed",
        "Grailed returned HTML, but no parseable public listing cards were found.",
      );
    }

    const fetchedAt = new Date().toISOString();
    const warnings: ProviderWarning[] = [];
    const listings = parsedCards
      .slice(0, pageSize)
      .map((card) => {
        if (!card.sourceUrl && !card.title) {
          warnings.push({
            code: "partial_card_skipped",
            message: "Skipped a Grailed card with no source URL and no title.",
          });
          return null;
        }

        return normalizeGrailedListing(
          createGrailedListingInputFromParsedCard(card, fetchedAt),
        );
      })
      .filter((listing): listing is NonNullable<typeof listing> => listing !== null);

    if (listings.length === 0 && parsedCards.length > 0) {
      return createFailure(
        "normalization_failed",
        "Grailed cards were found, but none could be normalized into shared listings.",
      );
    }

    const hasMore = parsedCards.length >= pageSize;

    return createSuccess(
      listings,
      {
        page,
        pageSize,
        hasMore,
        nextPage: hasMore ? page + 1 : undefined,
      },
      warnings.length > 0 ? warnings : undefined,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return createFailure("timeout", "Grailed scraping request timed out.", true);
    }

    return createFailure(
      "unavailable",
      error instanceof Error
        ? error.message
        : "Grailed scraping request failed before a response was returned.",
    );
  }
}

export function createGrailedProvider(options: GrailedProviderOptions = {}): Provider {
  const runtimeMode = options.runtimeMode ?? "fixture";
  const fixtureListings = options.fixtureListings ?? grailedFixtureListings;
  const baseUrl = toTrimmedString(options.baseUrl) || defaultBaseUrl;
  const userAgent = toTrimmedString(options.userAgent) || defaultUserAgent;
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
  const minRequestIntervalMs = options.minRequestIntervalMs ?? defaultMinRequestIntervalMs;
  const maxResultsPerSearch = options.maxResultsPerSearch ?? defaultMaxResultsPerSearch;

  return {
    id: GRAILED_PROVIDER_ID,
    name: GRAILED_PROVIDER_NAME,
    capabilities: grailedCapabilities,
    async search(request) {
      if (runtimeMode === "fixture") {
        return searchFixtureListings(fixtureListings, request, maxResultsPerSearch);
      }

      if (!options.fetchImpl) {
        return createFailure(
          "unavailable",
          "Grailed authorized-live mode is configured but no server-side HTTP fetch implementation is available.",
        );
      }

      return searchAuthorizedLiveListings(request, {
        baseUrl,
        fetchImpl: options.fetchImpl,
        maxResultsPerSearch,
        minRequestIntervalMs,
        requestTimeoutMs,
        scrapingAllowed: options.scrapingAllowed === true,
        userAgent,
        nowImpl: options.nowImpl,
        sleepImpl: options.sleepImpl,
      });
    },
  };
}
