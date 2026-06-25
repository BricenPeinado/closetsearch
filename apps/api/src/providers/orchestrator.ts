import type {
  Provider,
  ProviderFailure,
  ProviderSearchResponse,
} from "@closetsearch/providers";
import type { SearchProviderSummary, SearchQuery } from "@closetsearch/shared";
import { sanitizeProviderListing } from "./listing-sanitizer.js";
import {
  createProviderRuntime,
  type ActiveProviderRegistration,
  type ProviderPreflightFailure,
  type ProviderRuntime,
} from "./registry.js";

export interface ProviderSearchExecution {
  failures: ProviderFailure[];
  hasMore: boolean;
  listings: ReturnType<typeof sanitizeProviderListing>[];
  nextCursor?: string;
  providers: SearchProviderSummary[];
}

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

function supportsQuery(provider: Provider, query: SearchQuery): ProviderFailure | null {
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

  if (query.cursor && capabilities?.supportsPagination === false) {
    return createFailure(
      provider.id,
      "unsupported_capability",
      `${provider.name} does not support provider-native cursors yet.`,
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

export async function runProviderSearch(
  query: SearchQuery,
  runtime: ProviderRuntime = createProviderRuntime(),
): Promise<ProviderSearchExecution> {
  const listings: ReturnType<typeof sanitizeProviderListing>[] = [];
  const providers: SearchProviderSummary[] = runtime.preflightFailures.map(createFailureSummary);
  const failures: ProviderFailure[] = runtime.preflightFailures.map(({ failure }) => failure);
  let hasMore = false;
  let nextCursor: string | undefined;

  for (const registration of runtime.activeProviders) {
    const unsupportedFailure = supportsQuery(registration.provider, query);

    if (unsupportedFailure) {
      failures.push(unsupportedFailure);
      providers.push({
        providerId: registration.provider.id,
        providerName: registration.name,
        status: "failure",
        resultCount: 0,
      });
      continue;
    }

    try {
      const response = await withTimeout(
        registration.provider.search(query),
        runtime.config.requestTimeoutMs,
        registration.provider,
      );

      providers.push(buildProviderSummary(registration, response));

      if (response.status === "success") {
        listings.push(...response.listings.map(sanitizeProviderListing));
        hasMore = hasMore || Boolean(response.hasMore);
        nextCursor ??= response.nextCursor;
      } else {
        failures.push(response.failure);
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

      failures.push(failure);
      providers.push({
        providerId: registration.provider.id,
        providerName: registration.name,
        status: "failure",
        resultCount: 0,
      });
    }
  }

  // TODO: When real providers are added, layer in caching and conservative retries here.
  return {
    listings,
    providers,
    failures,
    hasMore,
    nextCursor,
  };
}
