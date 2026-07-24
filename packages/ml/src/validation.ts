import { normalizeToken, toTimestamp } from "./deterministic.js";
import {
  MARKET_FEATURE_SCHEMA_VERSION,
  RECOMMENDATION_FEATURE_SCHEMA_VERSION,
  assertFeatureSchemaVersion,
} from "./schema.js";
import { assertTemporalIsolation, createTemporalSplit } from "./temporal.js";
import type {
  MarketObservation,
  MarketSnapshot,
  RecommendationSnapshot,
} from "./types.js";

function assertIntegerMinorUnits(
  value: number | undefined,
  fieldName: string,
  allowUndefined = true,
) {
  if (value === undefined && allowUndefined) {
    return;
  }

  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new Error(`${fieldName} must use a non-negative safe integer number of minor units.`);
  }
}

function assertCurrency(value: string, fieldName: string) {
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new Error(`${fieldName} must be an uppercase ISO-style three-letter currency.`);
  }
}

export function validateRecommendationSnapshot(snapshot: RecommendationSnapshot) {
  assertFeatureSchemaVersion(
    snapshot.metadata.featureSchemaVersion,
    RECOMMENDATION_FEATURE_SCHEMA_VERSION,
    "Recommendation snapshot",
  );

  if (!snapshot.metadata.snapshotId.trim()) {
    throw new Error("Recommendation snapshotId is required.");
  }

  toTimestamp(snapshot.metadata.createdAt, "snapshot.createdAt");
  const listingIds = new Set<string>();

  for (const listing of snapshot.listings) {
    if (!listing.listingId.trim() || listingIds.has(listing.listingId)) {
      throw new Error(`Recommendation listing ids must be non-empty and unique: ${listing.listingId}`);
    }

    listingIds.add(listing.listingId);
    assertIntegerMinorUnits(listing.priceMinor, "listing.priceMinor", false);
    assertCurrency(listing.currency, "listing.currency");
    toTimestamp(listing.availableAt, "listing.availableAt");
  }

  const eventIds = new Set<string>();

  for (const event of snapshot.events) {
    if (!event.eventId.trim() || eventIds.has(event.eventId)) {
      throw new Error(`Recommendation event ids must be non-empty and unique: ${event.eventId}`);
    }

    if (!listingIds.has(event.listingId)) {
      throw new Error(`Recommendation event ${event.eventId} references an unknown listing.`);
    }

    eventIds.add(event.eventId);
    toTimestamp(event.occurredAt, "event.occurredAt");
  }

  const split = createTemporalSplit(
    snapshot.events,
    (event) => event.occurredAt,
    snapshot.splitBoundaries,
  );
  assertTemporalIsolation(
    split,
    (event) => event.occurredAt,
    (event) => event.eventId,
  );

  return split;
}

export function validateMarketObservation(observation: MarketObservation) {
  if (!observation.observationId.trim() || !observation.deduplicationKey.trim()) {
    throw new Error("Market observation and deduplication ids are required.");
  }

  assertCurrency(observation.currency, "observation.currency");
  assertCurrency(observation.normalizedCurrency, "observation.normalizedCurrency");
  assertCurrency(observation.originalCurrency, "observation.originalCurrency");
  assertIntegerMinorUnits(observation.askingPriceMinor, "observation.askingPriceMinor");
  assertIntegerMinorUnits(observation.soldPriceMinor, "observation.soldPriceMinor");
  assertIntegerMinorUnits(observation.shippingMinor, "observation.shippingMinor");
  toTimestamp(observation.listedAt, "observation.listedAt");
  toTimestamp(observation.observedAt, "observation.observedAt");

  if (
    observation.sourceConfidence < 0 ||
    observation.sourceConfidence > 1 ||
    observation.sellerConfidence < 0 ||
    observation.sellerConfidence > 1
  ) {
    throw new Error("Market confidence values must be between zero and one.");
  }

  if (observation.status === "sold") {
    if (!Number.isSafeInteger(observation.soldPriceMinor) || !observation.soldAt) {
      throw new Error("Sold observations require soldPriceMinor and soldAt.");
    }

    toTimestamp(observation.soldAt, "observation.soldAt");
  } else if (observation.soldPriceMinor !== undefined || observation.soldAt !== undefined) {
    throw new Error("Non-sold observations cannot carry a realized sold target.");
  }

  if (
    !normalizeToken(observation.canonicalBrand) ||
    !normalizeToken(observation.category) ||
    !normalizeToken(observation.source)
  ) {
    throw new Error("Market observations require canonical brand, category, and source.");
  }
}

export function validateMarketSnapshot(snapshot: MarketSnapshot) {
  assertFeatureSchemaVersion(
    snapshot.metadata.featureSchemaVersion,
    MARKET_FEATURE_SCHEMA_VERSION,
    "Market snapshot",
  );
  toTimestamp(snapshot.metadata.createdAt, "snapshot.createdAt");

  const observationIds = new Set<string>();

  for (const observation of snapshot.observations) {
    validateMarketObservation(observation);

    if (observationIds.has(observation.observationId)) {
      throw new Error(`Duplicate market observation id: ${observation.observationId}`);
    }

    observationIds.add(observation.observationId);
  }

  const soldRows = snapshot.observations.filter(
    (observation): observation is MarketObservation & { soldAt: string } =>
      observation.status === "sold" && observation.soldAt !== undefined,
  );
  const split = createTemporalSplit(
    soldRows,
    (observation) => observation.soldAt,
    snapshot.splitBoundaries,
  );
  assertTemporalIsolation(
    split,
    (observation) => observation.soldAt,
    (observation) => observation.observationId,
  );

  return split;
}
