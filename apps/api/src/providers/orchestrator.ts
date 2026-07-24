import { createHash } from "node:crypto";
import type {
  Provider,
  ProviderFailure,
  ProviderPagination,
  ProviderSearchRequest,
  ProviderSearchResponse,
  ProviderSearchResult,
} from "@closetsearch/providers";
import type {
  Listing,
  PaginationInfo,
  SearchProviderSummary,
  SearchQuery,
} from "@closetsearch/shared";
import { logWarn } from "../logger.js";
import { incrementCounter, observeHistogram } from "../metrics.js";
import { sanitizeProviderListing } from "./listing-sanitizer.js";
import {
  type ActiveProviderRegistration,
  type ProviderPreflightFailure,
  type ProviderRuntime,
} from "./registry.js";

export const PROVIDER_SEARCH_CACHE_TTL_MS = 15_000;
export const PROVIDER_SEARCH_CACHE_STALE_MS = 60_000;
const cursorVersion = 1;
const defaultRequestedPageSize = 24;
const maxProviderBatchAdvances = 8;

interface ProviderCursorState {
  cursor?: string;
  exhausted?: boolean;
  page?: number;
  providerId: string;
  totalCount?: number;
}

interface SearchCursorPayload {
  page: number;
  pageSize: number;
  providers: ProviderCursorState[];
  queryKey: string;
  seenKeys: string[];
  version: number;
}

interface ProviderCandidatePage {
  availableListings: Array<{
    dedupeKey: string;
    dedupeKeys: string[];
    listing: Listing;
    providerId: string;
  }>;
  pagination?: ProviderPagination;
  state: ProviderCursorState;
  summary: SearchProviderSummary;
}

interface ProviderCollectionResult {
  candidatePage?: ProviderCandidatePage;
  failure?: ProviderFailure;
  nextState: ProviderCursorState;
  summary?: SearchProviderSummary;
}

interface CachedProviderBatch {
  expiresAt: number;
  staleUntil: number;
  value: ProviderSearchResult;
}

export interface ProviderSearchExecution {
  failures: ProviderFailure[];
  listings: Listing[];
  pagination: PaginationInfo;
  providers: SearchProviderSummary[];
}

const providerSearchCache = new Map<string, CachedProviderBatch>();

function createFailure(
  providerId: string,
  code: ProviderFailure["code"],
  message: string,
  retryable = false,
): ProviderFailure {
  return {
    providerId,
    code,
    message,
    retryable,
  };
}

function createFailureSummary(failure: ProviderPreflightFailure): SearchProviderSummary {
  return {
    degraded: true,
    failure: {
      code: failure.failure.code,
      message: failure.failure.message,
      retryable: failure.failure.retryable === true,
    },
    providerId: failure.providerId,
    providerName: failure.providerName,
    status: "failure",
    resultCount: 0,
  };
}

function supportsQuery(
  provider: Provider,
  query: ProviderSearchRequest["query"],
  state: ProviderCursorState,
): ProviderFailure | null {
  const capabilities = provider.capabilities;

  if (query.marketScope === "sold" && capabilities?.supportsSoldListings === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} does not support sold-listing history.`,
    );
  }

  if (query.brandSlugs?.length && capabilities?.supportsBrandFilter === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} cannot safely map normalized brand filters.`,
    );
  }

  if (query.categories?.length && capabilities?.supportsCategoryFilter === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} cannot safely map normalized category filters.`,
    );
  }

  if (query.sizes?.length && capabilities?.supportsSizeFilter === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} cannot safely map normalized size filters.`,
    );
  }

  if (query.conditions?.length && capabilities?.supportsConditionFilter === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} cannot safely map normalized condition filters.`,
    );
  }

  if (query.price && capabilities?.supportsPriceRange === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} does not support price range filters yet.`,
    );
  }

  if (query.listingTypes?.length && capabilities?.supportedListingTypes) {
    const hasUnsupportedListingType = query.listingTypes.some(
      (listingType) => !capabilities.supportedListingTypes?.includes(listingType),
    );

    if (hasUnsupportedListingType) {
      return createFailure(
        provider.id,
        "unsupported_capability",
        `${provider.name} does not support one or more requested listing types.`,
      );
    }
  }

  if (query.sort && capabilities?.supportedSortModes) {
    const supportsSortMode = capabilities.supportedSortModes.includes(query.sort);

    if (!supportsSortMode) {
      return createFailure(
        provider.id,
        "unsupported_capability",
        `${provider.name} does not support the requested sort mode.`,
      );
    }
  }

  if (state.cursor && capabilities?.supportsCursorPagination === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} does not support provider-native cursors yet.`,
    );
  }

  if ((state.page ?? 1) > 1 && capabilities?.supportsPagePagination === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} does not support provider page-based pagination yet.`,
    );
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: Provider) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            createFailure(
              provider.id,
              "timeout",
              `${provider.name} exceeded the configured provider timeout.`,
              true,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildProviderSummary(
  registration: ActiveProviderRegistration,
  response: ProviderSearchResponse,
): SearchProviderSummary {
  if (response.status === "success") {
    const warningMessages = response.warnings?.map((warning) => warning.message);
    const degraded = response.metadata?.freshness === "stale" || Boolean(warningMessages?.length);

    return {
      cacheStatus: response.metadata?.cacheStatus,
      dataOrigin: response.metadata?.dataOrigin ?? registration.provider.dataOrigin,
      degraded: degraded || undefined,
      fetchedAt: response.metadata?.fetchedAt,
      freshness: response.metadata?.freshness,
      latencyMs: response.metadata?.latencyMs,
      providerId: registration.provider.id,
      providerName: registration.name,
      status: "success",
      resultCount: response.listings.length,
      warnings: warningMessages?.length ? warningMessages : undefined,
    };
  }

  return {
    degraded: true,
    failure: {
      code: response.failure.code,
      message: response.failure.message,
      retryable: response.failure.retryable === true,
    },
    providerId: registration.provider.id,
    providerName: registration.name,
    status: "failure",
    resultCount: 0,
  };
}

function sortListings(listings: Listing[], sort: SearchQuery["sort"]) {
  const sorted = [...listings];
  const stableTieBreak = (left: Listing, right: Listing) =>
    [left.providerId, left.providerListingId, left.id]
      .join(":")
      .localeCompare([right.providerId, right.providerListingId, right.id].join(":"));
  const getTimestamp = (listing: Listing) =>
    new Date(
      listing.lifecycle?.sourceUpdatedAt ?? listing.lifecycle?.listedAt ?? listing.fetchedAt,
    ).getTime();

  switch (sort) {
    case "price_asc":
      sorted.sort((left, right) => {
        const currencyComparison = left.price.currency.localeCompare(right.price.currency);
        return (
          currencyComparison ||
          left.price.amount - right.price.amount ||
          stableTieBreak(left, right)
        );
      });
      break;
    case "price_desc":
      sorted.sort((left, right) => {
        const currencyComparison = left.price.currency.localeCompare(right.price.currency);
        return (
          currencyComparison ||
          right.price.amount - left.price.amount ||
          stableTieBreak(left, right)
        );
      });
      break;
    case "newest":
    case "relevance":
    default:
      sorted.sort(
        (left, right) => getTimestamp(right) - getTimestamp(left) || stableTieBreak(left, right),
      );
      break;
  }

  return sorted;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function normalizeFingerprintText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createCanonicalListingFingerprint(listing: Listing) {
  const title = normalizeFingerprintText(listing.title);
  const brand = normalizeFingerprintText(listing.brand.slug);
  const category = normalizeFingerprintText(listing.category ?? "");
  const size = normalizeFingerprintText(listing.size ?? "");
  let imageIdentity: string;

  try {
    const imageUrl = new URL(listing.imageUrl);
    imageIdentity = `${imageUrl.hostname.toLowerCase()}${imageUrl.pathname.toLowerCase()}`;
  } catch {
    return undefined;
  }

  if (
    title.length < 8 ||
    !brand ||
    brand === "unknown brand" ||
    (!category && !size) ||
    !imageIdentity
  ) {
    return undefined;
  }

  return [
    title,
    brand,
    category,
    size,
    listing.condition ?? "",
    listing.price.currency.toUpperCase(),
    String(listing.price.amountMinor ?? listing.price.amount),
    imageIdentity,
  ].join("|");
}

function createListingDedupeKey(listing: Listing) {
  return createHash("sha1")
    .update(`source:${listing.providerId}:${listing.providerListingId}`)
    .digest("base64url")
    .slice(0, 16);
}

function createListingDedupeKeys(listing: Listing) {
  const keys = [createListingDedupeKey(listing)];
  const canonicalFingerprint = createCanonicalListingFingerprint(listing);

  if (canonicalFingerprint) {
    keys.push(
      createHash("sha1")
        .update(`canonical:${canonicalFingerprint}`)
        .digest("base64url")
        .slice(0, 16),
    );
  }

  return keys;
}

function sanitizeProviderResult(result: ProviderSearchResult): ProviderSearchResult {
  const sanitizedListings = result.listings
    .map((listing) => sanitizeProviderListing(listing))
    .filter((listing): listing is Listing => listing !== null);

  if (sanitizedListings.length !== result.listings.length) {
    const droppedCount = result.listings.length - sanitizedListings.length;
    logWarn("Dropped malformed provider listings", {
      droppedCount,
      providerId: result.providerId,
    });

    result = {
      ...result,
      warnings: [
        ...(result.warnings ?? []),
        {
          code: "normalization_dropped",
          message: `Dropped ${droppedCount} malformed provider listings.`,
          severity: "warning",
        },
      ],
    };
  }

  return {
    ...result,
    listings: sanitizedListings,
    metadata: result.metadata
      ? {
          ...result.metadata,
          pagination: result.metadata.pagination ? { ...result.metadata.pagination } : undefined,
        }
      : undefined,
    pagination: result.pagination ? { ...result.pagination } : undefined,
    warnings: result.warnings ? [...result.warnings] : undefined,
  };
}

function cleanupExpiredCacheEntries(now = Date.now()) {
  for (const [key, entry] of providerSearchCache.entries()) {
    if (entry.staleUntil <= now) {
      providerSearchCache.delete(key);
    }
  }
}

function getCachedProviderBatch(cacheKey: string) {
  cleanupExpiredCacheEntries();
  const cachedEntry = providerSearchCache.get(cacheKey);

  if (!cachedEntry) {
    return undefined;
  }

  if (cachedEntry.staleUntil <= Date.now()) {
    providerSearchCache.delete(cacheKey);
    return undefined;
  }

  return {
    status: cachedEntry.expiresAt <= Date.now() ? ("stale" as const) : ("fresh" as const),
    value: cachedEntry.value,
  };
}

function setCachedProviderBatch(cacheKey: string, value: ProviderSearchResult) {
  providerSearchCache.set(cacheKey, {
    expiresAt: Date.now() + PROVIDER_SEARCH_CACHE_TTL_MS,
    staleUntil: Date.now() + PROVIDER_SEARCH_CACHE_TTL_MS + PROVIDER_SEARCH_CACHE_STALE_MS,
    value,
  });
}

function stripPaginationQuery(query: SearchQuery): ProviderSearchRequest["query"] {
  const { cursor: _cursor, page: _page, pageSize: _pageSize, ...providerQuery } = query;
  return providerQuery;
}

function createQueryKey(
  query: ProviderSearchRequest["query"],
  requestedPageSize: number,
  activeProviders: ActiveProviderRegistration[],
) {
  return stableSerialize({
    providers: activeProviders.map((registration) => ({
      id: registration.provider.id,
      mode: registration.mode,
      name: registration.name,
    })),
    query,
    requestedPageSize,
  });
}

function encodeCursor(payload: SearchCursorPayload) {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): SearchCursorPayload | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    ) as SearchCursorPayload;

    if (
      parsedValue.version !== cursorVersion ||
      typeof parsedValue.queryKey !== "string" ||
      !Array.isArray(parsedValue.providers) ||
      !Array.isArray(parsedValue.seenKeys) ||
      typeof parsedValue.page !== "number" ||
      typeof parsedValue.pageSize !== "number"
    ) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

function normalizeRequestedPageSize(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return defaultRequestedPageSize;
  }

  return Math.trunc(value);
}

function hasProviderWork(state: ProviderCursorState) {
  return state.exhausted !== true;
}

function advanceProviderState(
  state: ProviderCursorState,
  pagination?: ProviderPagination,
): ProviderCursorState {
  if (!pagination?.hasMore) {
    return {
      providerId: state.providerId,
      exhausted: true,
      totalCount: state.totalCount,
    };
  }

  if (pagination.nextCursor) {
    return {
      providerId: state.providerId,
      cursor: pagination.nextCursor,
      totalCount: pagination.totalCount ?? state.totalCount,
    };
  }

  if (typeof pagination.nextPage === "number") {
    return {
      providerId: state.providerId,
      page: pagination.nextPage,
      totalCount: pagination.totalCount ?? state.totalCount,
    };
  }

  if (typeof pagination.page === "number") {
    return {
      providerId: state.providerId,
      page: pagination.page + 1,
      totalCount: pagination.totalCount ?? state.totalCount,
    };
  }

  if (typeof state.page === "number") {
    return {
      providerId: state.providerId,
      page: state.page + 1,
      totalCount: pagination.totalCount ?? state.totalCount,
    };
  }

  return {
    providerId: state.providerId,
    exhausted: true,
    totalCount: pagination?.totalCount ?? state.totalCount,
  };
}

function mergeProviderState(
  registration: ActiveProviderRegistration,
  cursorState: SearchCursorPayload | null,
): ProviderCursorState {
  const previousState = cursorState?.providers.find(
    (state) => state.providerId === registration.provider.id,
  );

  if (previousState) {
    return {
      providerId: registration.provider.id,
      cursor: previousState.cursor,
      exhausted: previousState.exhausted,
      page: previousState.page,
      totalCount: previousState.totalCount,
    };
  }

  return {
    providerId: registration.provider.id,
    page: 1,
  };
}

async function fetchProviderBatch(
  registration: ActiveProviderRegistration,
  query: ProviderSearchRequest["query"],
  state: ProviderCursorState,
  requestedPageSize: number,
  runtime: ProviderRuntime,
): Promise<ProviderSearchResponse> {
  const cacheKey = stableSerialize({
    pageSize: requestedPageSize,
    pagination: {
      cursor: state.cursor,
      page: state.page,
    },
    providerId: registration.provider.id,
    providerMode: registration.mode,
    query,
  });
  const cachedResponse = getCachedProviderBatch(cacheKey);

  const executeSearch = async () => {
    const startedAt = performance.now();
    let outcome: "failure" | "success" = "failure";
    let rateLimited = false;

    try {
      const response = await withTimeout(
        registration.provider.search({
          query,
          pagination: {
            cursor: state.cursor,
            page: state.page,
            pageSize: requestedPageSize,
          },
        }),
        runtime.config.requestTimeoutMs,
        registration.provider,
      );

      if (response.status === "success") {
        const sanitizedResponse = sanitizeProviderResult(response);
        setCachedProviderBatch(cacheKey, sanitizedResponse);
        outcome = "success";
        return sanitizedResponse;
      }

      rateLimited = response.failure.code === "rate_limited";
      return response;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      rateLimited = code === "rate_limited";
      throw error;
    } finally {
      incrementCounter("closetsearch_provider_requests_total", {
        outcome,
        provider: registration.provider.id,
      });
      observeHistogram(
        "closetsearch_provider_request_duration_ms",
        { provider: registration.provider.id },
        performance.now() - startedAt,
      );
      if (rateLimited) {
        incrementCounter("closetsearch_provider_rate_limits_total", {
          provider: registration.provider.id,
        });
      }
    }
  };

  if (cachedResponse?.status === "fresh") {
    incrementCounter("closetsearch_provider_cache_total", {
      provider: registration.provider.id,
      status: "fresh",
    });
    return {
      ...cachedResponse.value,
      metadata: {
        ...cachedResponse.value.metadata,
        providerId: cachedResponse.value.providerId,
        fetchedAt: cachedResponse.value.metadata?.fetchedAt ?? new Date().toISOString(),
        cacheStatus: "fresh",
      },
    };
  }

  if (cachedResponse?.status === "stale") {
    incrementCounter("closetsearch_provider_cache_total", {
      provider: registration.provider.id,
      status: "stale",
    });
    void executeSearch().catch((error: unknown) => {
      logWarn("Provider stale-cache refresh failed", {
        providerId: registration.provider.id,
        errorName: error instanceof Error ? error.name : "UnknownProviderError",
      });
    });

    return {
      ...cachedResponse.value,
      metadata: {
        ...cachedResponse.value.metadata,
        providerId: cachedResponse.value.providerId,
        fetchedAt: cachedResponse.value.metadata?.fetchedAt ?? new Date().toISOString(),
        cacheStatus: "stale",
        freshness: "stale",
      },
    };
  }

  incrementCounter("closetsearch_provider_cache_total", {
    provider: registration.provider.id,
    status: "miss",
  });
  const response = await executeSearch();
  return response.status === "success"
    ? {
        ...response,
        metadata: {
          ...response.metadata,
          providerId: response.providerId,
          fetchedAt: response.metadata?.fetchedAt ?? new Date().toISOString(),
          cacheStatus: "miss",
        },
      }
    : response;
}

async function collectProviderCandidates(
  registration: ActiveProviderRegistration,
  query: ProviderSearchRequest["query"],
  initialState: ProviderCursorState,
  seenKeys: Set<string>,
  requestedPageSize: number,
  runtime: ProviderRuntime,
): Promise<ProviderCollectionResult> {
  if (!hasProviderWork(initialState)) {
    return {
      nextState: initialState,
      summary: {
        providerId: registration.provider.id,
        providerName: registration.name,
        status: "success",
        resultCount: 0,
      },
    };
  }

  const unsupportedFailure = supportsQuery(registration.provider, query, initialState);

  if (unsupportedFailure) {
    return {
      failure: unsupportedFailure,
      nextState: {
        providerId: initialState.providerId,
        exhausted: true,
        totalCount: initialState.totalCount,
      },
      summary: {
        providerId: registration.provider.id,
        providerName: registration.name,
        status: "failure",
        resultCount: 0,
      },
    };
  }

  let state = { ...initialState };

  for (
    let attempt = 0;
    attempt < maxProviderBatchAdvances && hasProviderWork(state);
    attempt += 1
  ) {
    try {
      const response = await fetchProviderBatch(
        registration,
        query,
        state,
        requestedPageSize,
        runtime,
      );
      const summary = buildProviderSummary(registration, response);

      if (response.status === "failure") {
        return {
          failure: response.failure,
          nextState: state,
          summary,
        };
      }

      const nextStateBase = {
        ...state,
        totalCount: response.pagination?.totalCount ?? state.totalCount,
      };
      const availableListings = response.listings
        .map((listing) => {
          const dedupeKeys = createListingDedupeKeys(listing);
          return {
            dedupeKey: dedupeKeys[0] ?? createListingDedupeKey(listing),
            dedupeKeys,
            listing,
            providerId: registration.provider.id,
          };
        })
        .filter((candidate) => !candidate.dedupeKeys.some((key) => seenKeys.has(key)));

      if (availableListings.length > 0) {
        return {
          candidatePage: {
            availableListings,
            pagination: response.pagination,
            state: nextStateBase,
            summary,
          },
          nextState: nextStateBase,
          summary,
        };
      }

      state = advanceProviderState(nextStateBase, response.pagination);

      if (!hasProviderWork(state)) {
        return {
          nextState: state,
          summary,
        };
      }
    } catch {
      const failure = createFailure(
        registration.provider.id,
        "unavailable",
        `${registration.name} could not complete the request.`,
      );

      return {
        failure,
        nextState: state,
        summary: {
          degraded: true,
          failure: {
            code: failure.code,
            message: failure.message,
            retryable: failure.retryable === true,
          },
          providerId: registration.provider.id,
          providerName: registration.name,
          status: "failure",
          resultCount: 0,
        },
      };
    }
  }

  return {
    nextState: {
      providerId: state.providerId,
      exhausted: true,
      totalCount: state.totalCount,
    },
    summary: {
      providerId: registration.provider.id,
      providerName: registration.name,
      status: "success",
      resultCount: 0,
    },
  };
}

export function resetProviderSearchCache() {
  providerSearchCache.clear();
}

export async function runProviderSearch(
  query: SearchQuery,
  runtime: ProviderRuntime,
): Promise<ProviderSearchExecution> {
  const activeProviders = runtime.activeProviders.slice(0, runtime.config.maxProvidersPerRequest);
  const providerQuery = stripPaginationQuery(query);
  const decodedCursor = decodeCursor(query.cursor);
  const requestedPageSize = normalizeRequestedPageSize(query.pageSize ?? decodedCursor?.pageSize);
  const queryKey = createQueryKey(providerQuery, requestedPageSize, activeProviders);
  const cursorState = decodedCursor?.queryKey === queryKey ? decodedCursor : null;
  const currentPage = cursorState?.page ?? query.page ?? 1;
  const seenKeys = new Set(cursorState?.seenKeys ?? []);
  const providers = runtime.preflightFailures.map(createFailureSummary);
  const failures: ProviderFailure[] = runtime.preflightFailures.map(({ failure }) => failure);
  const collectionResults = await Promise.all(
    activeProviders.map(async (registration) => ({
      providerId: registration.provider.id,
      registration,
      result: await collectProviderCandidates(
        registration,
        providerQuery,
        mergeProviderState(registration, cursorState),
        seenKeys,
        requestedPageSize,
        runtime,
      ),
    })),
  );
  const candidateByProviderId = new Map<string, ProviderCandidatePage>();
  const nextProviderStates = new Map<string, ProviderCursorState>();
  const uniqueCandidates = new Map<
    string,
    {
      dedupeKey: string;
      dedupeKeys: string[];
      listing: Listing;
      providerId: string;
    }
  >();
  const claimedDedupeKeys = new Set<string>();

  for (const { providerId, result } of collectionResults) {
    if (result.summary) {
      providers.push(result.summary);
    }

    if (result.failure) {
      logWarn("Provider failure", {
        providerId: result.failure.providerId,
        code: result.failure.code,
        retryable: result.failure.retryable,
      });
      failures.push(result.failure);
    }

    nextProviderStates.set(providerId, result.nextState);

    if (result.candidatePage) {
      candidateByProviderId.set(providerId, result.candidatePage);

      for (const candidate of result.candidatePage.availableListings) {
        if (candidate.dedupeKeys.some((key) => claimedDedupeKeys.has(key))) {
          continue;
        }

        uniqueCandidates.set(candidate.dedupeKey, candidate);
        candidate.dedupeKeys.forEach((key) => claimedDedupeKeys.add(key));
      }
    }
  }

  const selectedCandidates = sortListings(
    Array.from(uniqueCandidates.values()).map((candidate) => candidate.listing),
    query.sort,
  )
    .slice(0, requestedPageSize)
    .map((listing) => {
      const dedupeKey = createListingDedupeKey(listing);
      const candidate = uniqueCandidates.get(dedupeKey);

      return {
        dedupeKey,
        dedupeKeys: candidate?.dedupeKeys ?? createListingDedupeKeys(listing),
        listing,
        providerId: candidate?.providerId ?? listing.providerId,
      };
    });

  for (const candidate of selectedCandidates) {
    candidate.dedupeKeys.forEach((key) => seenKeys.add(key));
  }

  for (const { providerId } of collectionResults) {
    const candidatePage = candidateByProviderId.get(providerId);

    if (!candidatePage) {
      continue;
    }

    const hasRemainingUnseenListings = candidatePage.availableListings.some(
      (candidate) => !candidate.dedupeKeys.some((key) => seenKeys.has(key)),
    );

    if (hasRemainingUnseenListings) {
      nextProviderStates.set(providerId, candidatePage.state);
      continue;
    }

    nextProviderStates.set(
      providerId,
      advanceProviderState(candidatePage.state, candidatePage.pagination),
    );
  }

  const normalizedProviderStates = activeProviders.map(
    (registration) =>
      nextProviderStates.get(registration.provider.id) ??
      mergeProviderState(registration, cursorState),
  );
  const hasMore = normalizedProviderStates.some(hasProviderWork);
  const totalCount = normalizedProviderStates.every((state) => typeof state.totalCount === "number")
    ? normalizedProviderStates.reduce((sum, state) => sum + (state.totalCount ?? 0), 0)
    : undefined;

  return {
    listings: selectedCandidates.map((candidate) => candidate.listing),
    providers,
    failures,
    pagination: {
      page: currentPage,
      pageSize: requestedPageSize,
      hasMore,
      nextPage: hasMore ? currentPage + 1 : undefined,
      nextCursor: hasMore
        ? encodeCursor({
            page: currentPage + 1,
            pageSize: requestedPageSize,
            providers: normalizedProviderStates,
            queryKey,
            seenKeys: Array.from(seenKeys),
            version: cursorVersion,
          })
        : undefined,
      totalCount,
    },
  };
}
