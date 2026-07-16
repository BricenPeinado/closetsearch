import { createHash } from "node:crypto";
import type {
  Provider,
  ProviderFailure,
  ProviderPagination,
  ProviderSearchRequest,
  ProviderSearchResponse,
  ProviderSearchResult,
} from "@closetsearch/providers";
import type { Listing, PaginationInfo, SearchProviderSummary, SearchQuery } from "@closetsearch/shared";
import { sanitizeProviderListing } from "./listing-sanitizer.js";
import {
  createProviderRuntime,
  type ActiveProviderRegistration,
  type ProviderPreflightFailure,
  type ProviderRuntime,
} from "./registry.js";

export const PROVIDER_SEARCH_CACHE_TTL_MS = 15_000;
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
    return {
      providerId: registration.provider.id,
      providerName: registration.name,
      status: "success",
      resultCount: response.listings.length,
    };
  }

  return {
    providerId: registration.provider.id,
    providerName: registration.name,
    status: "failure",
    resultCount: 0,
  };
}

function sortListings(listings: Listing[], sort: SearchQuery["sort"]) {
  const sorted = [...listings];

  switch (sort) {
    case "price_asc":
      sorted.sort((left, right) => left.price.amount - right.price.amount);
      break;
    case "price_desc":
      sorted.sort((left, right) => right.price.amount - left.price.amount);
      break;
    case "newest":
    case "relevance":
    default:
      sorted.sort(
        (left, right) =>
          new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime(),
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

function createListingIdentity(listing: Listing) {
  if (listing.providerId && listing.providerListingId) {
    return `${listing.providerId}:${listing.providerListingId}`;
  }

  if (listing.source.id && listing.sourceUrl) {
    return `${listing.source.id}:${listing.sourceUrl}`;
  }

  return [
    listing.title.trim().toLowerCase(),
    listing.brand.slug.trim().toLowerCase(),
    String(listing.price.amount),
    listing.price.currency.trim().toUpperCase(),
    listing.imageUrl.trim().toLowerCase(),
  ].join("|");
}

function createListingDedupeKey(listing: Listing) {
  return createHash("sha1")
    .update(createListingIdentity(listing))
    .digest("base64url")
    .slice(0, 16);
}

function sanitizeProviderResult(result: ProviderSearchResult): ProviderSearchResult {
  return {
    ...result,
    listings: result.listings.map(sanitizeProviderListing),
    metadata: result.metadata
      ? {
          ...result.metadata,
          pagination: result.metadata.pagination
            ? { ...result.metadata.pagination }
            : undefined,
        }
      : undefined,
    pagination: result.pagination ? { ...result.pagination } : undefined,
    warnings: result.warnings ? [...result.warnings] : undefined,
  };
}

function cleanupExpiredCacheEntries(now = Date.now()) {
  for (const [key, entry] of providerSearchCache.entries()) {
    if (entry.expiresAt <= now) {
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

  if (cachedEntry.expiresAt <= Date.now()) {
    providerSearchCache.delete(cacheKey);
    return undefined;
  }

  return cachedEntry.value;
}

function setCachedProviderBatch(cacheKey: string, value: ProviderSearchResult) {
  providerSearchCache.set(cacheKey, {
    expiresAt: Date.now() + PROVIDER_SEARCH_CACHE_TTL_MS,
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

  if (cachedResponse) {
    return cachedResponse;
  }

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
    return sanitizedResponse;
  }

  return response;
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

  for (let attempt = 0; attempt < maxProviderBatchAdvances && hasProviderWork(state); attempt += 1) {
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
        .map((listing) => ({
          dedupeKey: createListingDedupeKey(listing),
          listing,
          providerId: registration.provider.id,
        }))
        .filter((candidate) => !seenKeys.has(candidate.dedupeKey));

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
    } catch (error: unknown) {
      const failure =
        error && typeof error === "object" && "providerId" in error && "code" in error
          ? (error as ProviderFailure)
          : createFailure(
              registration.provider.id,
              "unavailable",
              error instanceof Error
                ? error.message
                : `${registration.name} could not complete the request.`,
            );

      return {
        failure,
        nextState: state,
        summary: {
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
  runtime: ProviderRuntime = createProviderRuntime(),
): Promise<ProviderSearchExecution> {
  const activeProviders = runtime.activeProviders.slice(0, runtime.config.maxProvidersPerRequest);
  const providerQuery = stripPaginationQuery(query);
  const decodedCursor = decodeCursor(query.cursor);
  const requestedPageSize = normalizeRequestedPageSize(
    query.pageSize ?? decodedCursor?.pageSize,
  );
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
      listing: Listing;
      providerId: string;
    }
  >();

  for (const { providerId, result } of collectionResults) {
    if (result.summary) {
      providers.push(result.summary);
    }

    if (result.failure) {
      console.error("Provider failure", {
        providerId: result.failure.providerId,
        code: result.failure.code,
        message: result.failure.message,
        retryable: result.failure.retryable,
      });
      failures.push(result.failure);
    }

    nextProviderStates.set(providerId, result.nextState);

    if (result.candidatePage) {
      candidateByProviderId.set(providerId, result.candidatePage);

      for (const candidate of result.candidatePage.availableListings) {
        if (!uniqueCandidates.has(candidate.dedupeKey)) {
          uniqueCandidates.set(candidate.dedupeKey, candidate);
        }
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
        listing,
        providerId: candidate?.providerId ?? listing.providerId,
      };
    });

  for (const candidate of selectedCandidates) {
    seenKeys.add(candidate.dedupeKey);
  }

  for (const { providerId } of collectionResults) {
    const candidatePage = candidateByProviderId.get(providerId);

    if (!candidatePage) {
      continue;
    }

    const hasRemainingUnseenListings = candidatePage.availableListings.some(
      (candidate) => !seenKeys.has(candidate.dedupeKey),
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
    (registration) => nextProviderStates.get(registration.provider.id) ?? mergeProviderState(registration, cursorState),
  );
  const hasMore = normalizedProviderStates.some(hasProviderWork);
  const totalCount = normalizedProviderStates.every(
    (state) => typeof state.totalCount === "number",
  )
    ? normalizedProviderStates.reduce(
        (sum, state) => sum + (state.totalCount ?? 0),
        0,
      )
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
