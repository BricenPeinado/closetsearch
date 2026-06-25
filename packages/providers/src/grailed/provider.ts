import type { SearchQuery, SearchSortMode } from "@closetsearch/shared";
import type {
  Provider,
  ProviderCapabilities,
  ProviderFailureCode,
  ProviderSearchFailure,
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
  supportsPagination: false,
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
  warnings?: ProviderWarning[],
): ProviderSearchResult {
  return {
    providerId: GRAILED_PROVIDER_ID,
    status: "success",
    listings,
    hasMore: false,
    warnings,
    metadata: {
      providerId: GRAILED_PROVIDER_ID,
      fetchedAt: new Date().toISOString(),
      resultCount: listings.length,
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

function getResultLimit(query: SearchQuery, maxResultsPerSearch: number) {
  if (typeof query.pageSize !== "number" || !Number.isFinite(query.pageSize)) {
    return maxResultsPerSearch;
  }

  return Math.max(1, Math.min(maxResultsPerSearch, Math.trunc(query.pageSize)));
}

function matchesFixtureQuery(raw: RawGrailedFixtureListing, query: SearchQuery) {
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
  query: SearchQuery,
  maxResultsPerSearch: number,
): Promise<ProviderSearchResult> {
  const resultLimit = getResultLimit(query, maxResultsPerSearch);
  const listings = sortFixtureListings(
    fixtureListings.filter((listing) => matchesFixtureQuery(listing, query)),
    query.sort,
  )
    .slice(0, resultLimit)
    .map((listing) => normalizeGrailedListing(createGrailedListingInputFromFixture(listing)));

  return createSuccess(listings);
}

async function searchAuthorizedLiveListings(
  query: SearchQuery,
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

  try {
    const response = await client.getHtml(
      buildGrailedSearchUrl({
        baseUrl: options.baseUrl,
        query,
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
        return createSuccess([]);
      }

      return createFailure(
        "normalization_failed",
        "Grailed returned HTML, but no parseable public listing cards were found.",
      );
    }

    const fetchedAt = new Date().toISOString();
    const warnings: ProviderWarning[] = [];
    const resultLimit = getResultLimit(query, options.maxResultsPerSearch);
    const listings = parsedCards
      .slice(0, resultLimit)
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

    return createSuccess(listings, warnings.length > 0 ? warnings : undefined);
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
    async search(query) {
      if (runtimeMode === "fixture") {
        return searchFixtureListings(fixtureListings, query, maxResultsPerSearch);
      }

      if (!options.fetchImpl) {
        return createFailure(
          "unavailable",
          "Grailed authorized-live mode is configured but no server-side HTTP fetch implementation is available.",
        );
      }

      return searchAuthorizedLiveListings(query, {
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
