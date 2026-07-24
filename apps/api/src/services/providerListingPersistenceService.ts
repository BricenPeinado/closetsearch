import type { Listing } from "@closetsearch/shared";
import { ApiError } from "../api-error.js";
import { resolvePersistenceDriver } from "../db/persistence-driver.js";
import { getPostgresDataPlane } from "../db/persistence-runtime.js";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { logWarn } from "../logger.js";
import { toListingObservation } from "../worker/provider-source.js";

const defaultPersistenceConcurrency = 4;

export interface ProviderListingPersistenceOptions {
  concurrency?: number;
  dataPlane?: PostgresDataPlane;
}

function ingestionScope(listing: Listing) {
  return listing.market?.status === "sold" || listing.lifecycle?.status === "sold"
    ? ("sold" as const)
    : ("active" as const);
}

function boundedConcurrency(value: number | undefined, listingCount: number) {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return Math.min(defaultPersistenceConcurrency, listingCount);
  }

  return Math.min(value, listingCount);
}

export async function persistProviderListings(
  listings: Listing[],
  options: ProviderListingPersistenceOptions = {},
) {
  if (
    listings.length === 0 ||
    (options.dataPlane === undefined && resolvePersistenceDriver() !== "postgres")
  ) {
    return;
  }

  try {
    const dataPlane = options.dataPlane ?? (await getPostgresDataPlane());
    const concurrency = boundedConcurrency(options.concurrency, listings.length);
    let nextIndex = 0;

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (nextIndex < listings.length) {
          const listing = listings[nextIndex];
          nextIndex += 1;

          if (listing) {
            await dataPlane.listings.upsertObservation(
              toListingObservation(listing, ingestionScope(listing)),
            );
          }
        }
      }),
    );
  } catch (error) {
    logWarn("Provider listing persistence failed", {
      errorName: error instanceof Error ? error.name : "UnknownProviderListingPersistenceError",
      listingCount: listings.length,
    });
    throw new ApiError(
      503,
      "catalog_persistence_unavailable",
      "Listings could not be made durable. Retry the request.",
    );
  }
}
