import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";
import type {
  ListingObservationInput,
  ListingObservationResult,
} from "../model.js";
import type { PgQueryable } from "../types.js";

interface ExistingListingRow extends QueryResultRow {
  id: string;
  fetched_at: Date;
}

interface CurrentStateRow extends QueryResultRow {
  availability: ListingObservationInput["availability"];
  lifecycle_version: string | number | bigint;
  market_status: ListingObservationInput["marketStatus"];
}

interface ObservationRow extends QueryResultRow {
  observation_version: string | number | bigint;
  original_price_minor: string | number | bigint;
  original_currency: string;
  comparison_price_minor: string | number | bigint | null;
  comparison_currency: string | null;
  sold_price_minor: string | number | bigint | null;
  sold_currency: string | null;
  shipping_price_minor: string | number | bigint | null;
  shipping_currency: string | null;
  market_status: ListingObservationInput["marketStatus"];
}

function asBigInt(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  return BigInt(value);
}

function normalizedCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

function sameNullableBigInt(
  left: string | number | bigint | null,
  right: bigint | undefined,
) {
  return asBigInt(left) === right;
}

function latestObservationMatches(
  row: ObservationRow,
  input: ListingObservationInput,
) {
  return (
    asBigInt(row.original_price_minor) === input.originalPrice.amountMinor &&
    row.original_currency === normalizedCurrency(input.originalPrice.currency) &&
    sameNullableBigInt(
      row.comparison_price_minor,
      input.comparisonPrice?.amountMinor,
    ) &&
    row.comparison_currency ===
      (input.comparisonPrice
        ? normalizedCurrency(input.comparisonPrice.currency)
        : null) &&
    sameNullableBigInt(row.sold_price_minor, input.soldPrice?.amountMinor) &&
    row.sold_currency ===
      (input.soldPrice ? normalizedCurrency(input.soldPrice.currency) : null) &&
    sameNullableBigInt(
      row.shipping_price_minor,
      input.shippingPrice?.amountMinor,
    ) &&
    row.shipping_currency ===
      (input.shippingPrice
        ? normalizedCurrency(input.shippingPrice.currency)
        : null) &&
    row.market_status === input.marketStatus
  );
}

async function findListingForUpdate(
  client: PgQueryable,
  input: Pick<ListingObservationInput, "providerId" | "sourceListingId">,
) {
  const result = await client.query<ExistingListingRow>(
    `SELECT id, fetched_at
     FROM listings
     WHERE provider_id = $1 AND source_listing_id = $2
     FOR UPDATE`,
    [input.providerId, input.sourceListingId],
  );

  return result.rows[0];
}

async function upsertListingRecord(
  client: PgQueryable,
  input: ListingObservationInput,
) {
  const result = await client.query<ExistingListingRow>(
    `INSERT INTO listings (
       id,
       provider_id,
       source_marketplace,
       source_listing_id,
       canonical_fingerprint,
       title,
       canonical_brand_id,
       provider_brand,
       category,
       size,
       condition,
       listing_type,
       source_url,
       seller_metadata,
       shipping_metadata,
       original_price_minor,
       original_currency,
       comparison_price_minor,
       comparison_currency,
       exchange_rate_source,
       exchange_rate_observed_at,
       shipping_price_minor,
       shipping_currency,
       landed_price_minor,
       landed_currency,
       listed_at,
       provider_updated_at,
       fetched_at,
       analytics_eligible,
       raw_fingerprint
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19, $20,
       $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
     )
     ON CONFLICT (provider_id, source_listing_id) DO UPDATE SET
       source_marketplace = EXCLUDED.source_marketplace,
       canonical_fingerprint = EXCLUDED.canonical_fingerprint,
       title = EXCLUDED.title,
       canonical_brand_id = EXCLUDED.canonical_brand_id,
       provider_brand = EXCLUDED.provider_brand,
       category = EXCLUDED.category,
       size = EXCLUDED.size,
       condition = EXCLUDED.condition,
       listing_type = EXCLUDED.listing_type,
       source_url = EXCLUDED.source_url,
       seller_metadata = EXCLUDED.seller_metadata,
       shipping_metadata = EXCLUDED.shipping_metadata,
       original_price_minor = EXCLUDED.original_price_minor,
       original_currency = EXCLUDED.original_currency,
       comparison_price_minor = EXCLUDED.comparison_price_minor,
       comparison_currency = EXCLUDED.comparison_currency,
       exchange_rate_source = EXCLUDED.exchange_rate_source,
       exchange_rate_observed_at = EXCLUDED.exchange_rate_observed_at,
       shipping_price_minor = EXCLUDED.shipping_price_minor,
       shipping_currency = EXCLUDED.shipping_currency,
       landed_price_minor = EXCLUDED.landed_price_minor,
       landed_currency = EXCLUDED.landed_currency,
       listed_at = EXCLUDED.listed_at,
       provider_updated_at = EXCLUDED.provider_updated_at,
       fetched_at = EXCLUDED.fetched_at,
       analytics_eligible = EXCLUDED.analytics_eligible,
       raw_fingerprint = EXCLUDED.raw_fingerprint,
       updated_at = CURRENT_TIMESTAMP
     WHERE EXCLUDED.fetched_at >= listings.fetched_at
     RETURNING id, fetched_at`,
    [
      input.id,
      input.providerId,
      input.sourceMarketplace,
      input.sourceListingId,
      input.canonicalFingerprint ?? null,
      input.title,
      input.canonicalBrandId ?? null,
      input.providerBrand ?? null,
      input.category ?? null,
      input.size ?? null,
      input.condition ?? null,
      input.listingType,
      input.sourceUrl,
      input.sellerMetadata ? JSON.stringify(input.sellerMetadata) : null,
      input.shippingMetadata ? JSON.stringify(input.shippingMetadata) : null,
      input.originalPrice.amountMinor,
      normalizedCurrency(input.originalPrice.currency),
      input.comparisonPrice?.amountMinor ?? null,
      input.comparisonPrice
        ? normalizedCurrency(input.comparisonPrice.currency)
        : null,
      input.comparisonPrice?.exchangeRateSource ?? null,
      input.comparisonPrice?.exchangeRateObservedAt ?? null,
      input.shippingPrice?.amountMinor ?? null,
      input.shippingPrice
        ? normalizedCurrency(input.shippingPrice.currency)
        : null,
      input.landedPrice?.amountMinor ?? null,
      input.landedPrice
        ? normalizedCurrency(input.landedPrice.currency)
        : null,
      input.listedAt ?? null,
      input.providerUpdatedAt ?? null,
      input.fetchedAt,
      input.analyticsEligible,
      input.rawFingerprint ?? null,
    ],
  );

  return result.rows[0];
}

async function replaceImages(
  client: PgQueryable,
  listingId: string,
  input: ListingObservationInput,
) {
  await client.query("DELETE FROM listing_images WHERE listing_id = $1", [
    listingId,
  ]);

  for (const [ordinal, image] of input.images.entries()) {
    await client.query(
      `INSERT INTO listing_images (
         id,
         listing_id,
         ordinal,
         image_url,
         width,
         height
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        listingId,
        ordinal,
        image.url,
        image.width ?? null,
        image.height ?? null,
      ],
    );
  }
}

async function upsertCurrentState(
  client: PgQueryable,
  listingId: string,
  input: ListingObservationInput,
) {
  const existingResult = await client.query<CurrentStateRow>(
    `SELECT availability, market_status, lifecycle_version
     FROM listing_current_state
     WHERE listing_id = $1
     FOR UPDATE`,
    [listingId],
  );
  const existing = existingResult.rows[0];
  const changed =
    !existing ||
    existing.availability !== input.availability ||
    existing.market_status !== input.marketStatus;
  const nextVersion = existing
    ? BigInt(existing.lifecycle_version) + (changed ? 1n : 0n)
    : 1n;

  await client.query(
    `INSERT INTO listing_current_state (
       listing_id,
       market_status,
       availability,
       first_seen_at,
       last_seen_at,
       stale_after,
       sold_at,
       removed_at,
       unavailable_at,
       lifecycle_version
     ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (listing_id) DO UPDATE SET
       market_status = EXCLUDED.market_status,
       availability = EXCLUDED.availability,
       last_seen_at = GREATEST(
         listing_current_state.last_seen_at,
         EXCLUDED.last_seen_at
       ),
       stale_after = EXCLUDED.stale_after,
       sold_at = COALESCE(EXCLUDED.sold_at, listing_current_state.sold_at),
       removed_at = CASE
         WHEN EXCLUDED.availability = 'removed' THEN EXCLUDED.last_seen_at
         ELSE listing_current_state.removed_at
       END,
       unavailable_at = CASE
         WHEN EXCLUDED.availability = 'unavailable' THEN EXCLUDED.last_seen_at
         ELSE listing_current_state.unavailable_at
       END,
       lifecycle_version = $9,
       updated_at = CURRENT_TIMESTAMP`,
    [
      listingId,
      input.marketStatus,
      input.availability,
      input.observedAt,
      input.staleAfter ?? null,
      input.soldAt ?? null,
      input.availability === "removed" ? input.observedAt : null,
      input.availability === "unavailable" ? input.observedAt : null,
      nextVersion,
    ],
  );

  if (changed) {
    await client.query(
      `INSERT INTO listing_state_transitions (
         listing_id,
         from_availability,
         to_availability,
         from_market_status,
         to_market_status,
         reason,
         occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        listingId,
        existing?.availability ?? null,
        input.availability,
        existing?.market_status ?? null,
        input.marketStatus,
        existing ? "provider_observation" : "first_observation",
        input.observedAt,
      ],
    );
  }

  return nextVersion;
}

async function recordPriceObservation(
  client: PgQueryable,
  listingId: string,
  input: ListingObservationInput,
) {
  const latestResult = await client.query<ObservationRow>(
    `SELECT
       observation_version,
       original_price_minor,
       original_currency,
       comparison_price_minor,
       comparison_currency,
       sold_price_minor,
       sold_currency,
       shipping_price_minor,
       shipping_currency,
       market_status
     FROM price_observations
     WHERE listing_id = $1
     ORDER BY observation_version DESC
     LIMIT 1
     FOR UPDATE`,
    [listingId],
  );
  const latest = latestResult.rows[0];

  if (latest && latestObservationMatches(latest, input)) {
    return asBigInt(latest.observation_version);
  }

  const inserted = await client.query<ObservationRow>(
    `INSERT INTO price_observations (
       observation_id,
       listing_id,
       idempotency_key,
       original_price_minor,
       original_currency,
       comparison_price_minor,
       comparison_currency,
       sold_price_minor,
       sold_currency,
       shipping_price_minor,
       shipping_currency,
       market_status,
       observed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     )
     RETURNING observation_version`,
    [
      randomUUID(),
      listingId,
      input.idempotencyKey,
      input.originalPrice.amountMinor,
      normalizedCurrency(input.originalPrice.currency),
      input.comparisonPrice?.amountMinor ?? null,
      input.comparisonPrice
        ? normalizedCurrency(input.comparisonPrice.currency)
        : null,
      input.soldPrice?.amountMinor ?? null,
      input.soldPrice ? normalizedCurrency(input.soldPrice.currency) : null,
      input.shippingPrice?.amountMinor ?? null,
      input.shippingPrice
        ? normalizedCurrency(input.shippingPrice.currency)
        : null,
      input.marketStatus,
      input.observedAt,
    ],
  );

  return asBigInt(inserted.rows[0]?.observation_version);
}

export class ListingRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async upsertObservation(
    input: ListingObservationInput,
  ): Promise<ListingObservationResult> {
    return this.database.withTransaction(async (client) => {
      const ingestionEventId = randomUUID();
      const priorEvent = await client.query(
        `SELECT id
         FROM listing_ingestion_events
         WHERE provider_id = $1 AND idempotency_key = $2`,
        [input.providerId, input.idempotencyKey],
      );

      if (priorEvent.rows.length > 0) {
        const existing = await findListingForUpdate(client, input);
        const latest = existing
          ? await client.query<ObservationRow>(
              `SELECT observation_version
               FROM price_observations
               WHERE listing_id = $1
               ORDER BY observation_version DESC
               LIMIT 1`,
              [existing.id],
            )
          : undefined;
        const current = existing
          ? await client.query<CurrentStateRow>(
              `SELECT lifecycle_version
               FROM listing_current_state
               WHERE listing_id = $1`,
              [existing.id],
            )
          : undefined;

        return {
          duplicate: true,
          lifecycleVersion: BigInt(
            current?.rows[0]?.lifecycle_version ?? 0,
          ),
          listingId: existing?.id ?? input.id,
          observationVersion: asBigInt(
            latest?.rows[0]?.observation_version,
          ),
          persisted: Boolean(existing),
          result: "duplicate",
        };
      }

      const eventResult = await client.query(
        `INSERT INTO listing_ingestion_events (
           id,
           provider_id,
           idempotency_key
         ) VALUES ($1, $2, $3)
         ON CONFLICT (provider_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [ingestionEventId, input.providerId, input.idempotencyKey],
      );

      if (eventResult.rows.length === 0) {
        const existing = await findListingForUpdate(client, input);
        const latest = existing
          ? await client.query<ObservationRow>(
              `SELECT observation_version
               FROM price_observations
               WHERE listing_id = $1
               ORDER BY observation_version DESC
               LIMIT 1`,
              [existing.id],
            )
          : undefined;
        const current = existing
          ? await client.query<CurrentStateRow>(
              `SELECT lifecycle_version
               FROM listing_current_state
               WHERE listing_id = $1`,
              [existing.id],
            )
          : undefined;

        return {
          duplicate: true,
          lifecycleVersion: BigInt(
            current?.rows[0]?.lifecycle_version ?? 0,
          ),
          listingId: existing?.id ?? input.id,
          observationVersion: asBigInt(
            latest?.rows[0]?.observation_version,
          ),
          persisted: Boolean(existing),
          result: "duplicate",
        };
      }

      const existing = await findListingForUpdate(client, input);

      if (existing && new Date(existing.fetched_at) > input.fetchedAt) {
        await client.query(
          `UPDATE listing_ingestion_events
           SET listing_id = $1,
               processed_at = CURRENT_TIMESTAMP,
               result = 'ignored_stale'
           WHERE id = $2`,
          [existing.id, ingestionEventId],
        );

        const current = await client.query<CurrentStateRow>(
          `SELECT lifecycle_version
           FROM listing_current_state
           WHERE listing_id = $1`,
          [existing.id],
        );
        const latest = await client.query<ObservationRow>(
          `SELECT observation_version
           FROM price_observations
           WHERE listing_id = $1
           ORDER BY observation_version DESC
           LIMIT 1`,
          [existing.id],
        );

        return {
          duplicate: false,
          lifecycleVersion: BigInt(
            current.rows[0]?.lifecycle_version ?? 0,
          ),
          listingId: existing.id,
          observationVersion: asBigInt(
            latest.rows[0]?.observation_version,
          ),
          persisted: false,
          result: "ignored_stale",
        };
      }

      const persisted = await upsertListingRecord(client, input);
      const listingId = persisted?.id ?? existing?.id;

      if (!listingId) {
        throw new Error("Listing upsert did not return a durable listing id.");
      }

      await replaceImages(client, listingId, input);
      const lifecycleVersion = await upsertCurrentState(
        client,
        listingId,
        input,
      );
      const observationVersion = await recordPriceObservation(
        client,
        listingId,
        input,
      );
      const result = existing ? "updated" : "inserted";

      await client.query(
        `UPDATE listing_ingestion_events
         SET listing_id = $1,
             processed_at = CURRENT_TIMESTAMP,
             result = $2
         WHERE id = $3`,
        [listingId, result, ingestionEventId],
      );

      return {
        duplicate: false,
        lifecycleVersion,
        listingId,
        observationVersion,
        persisted: true,
        result,
      };
    });
  }

  async latestPriceHistory(providerId: string, sourceListingId: string) {
    const result = await this.database.query<ObservationRow>(
      `SELECT
         po.observation_version,
         po.original_price_minor,
         po.original_currency,
         po.comparison_price_minor,
         po.comparison_currency,
         po.sold_price_minor,
         po.sold_currency,
         po.shipping_price_minor,
         po.shipping_currency,
         po.market_status
       FROM price_observations po
       JOIN listings l ON l.id = po.listing_id
       WHERE l.provider_id = $1 AND l.source_listing_id = $2
       ORDER BY po.observation_version DESC`,
      [providerId, sourceListingId],
    );

    return result.rows.map((row) => ({
      comparisonPriceMinor: asBigInt(row.comparison_price_minor),
      marketStatus: row.market_status,
      observationVersion: BigInt(row.observation_version),
      originalCurrency: row.original_currency,
      originalPriceMinor: BigInt(row.original_price_minor),
      soldPriceMinor: asBigInt(row.sold_price_minor),
    }));
  }

  async markStale(cutoff: Date, occurredAt: Date, limit = 500) {
    return this.database.withTransaction(async (client) => {
      const candidates = await client.query<{
        listing_id: string;
        lifecycle_version: string | number | bigint;
        market_status: ListingObservationInput["marketStatus"];
      }>(
        `SELECT listing_id, lifecycle_version, market_status
         FROM listing_current_state
         WHERE availability = 'available'
           AND last_seen_at < $1
         ORDER BY last_seen_at, listing_id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [cutoff, limit],
      );

      for (const candidate of candidates.rows) {
        const nextVersion = BigInt(candidate.lifecycle_version) + 1n;
        await client.query(
          `UPDATE listing_current_state
           SET availability = 'stale',
               lifecycle_version = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE listing_id = $1`,
          [candidate.listing_id, nextVersion],
        );
        await client.query(
          `INSERT INTO listing_state_transitions (
             listing_id,
             from_availability,
             to_availability,
             from_market_status,
             to_market_status,
             reason,
             occurred_at
           ) VALUES ($1, 'available', 'stale', $2, $2, 'staleness_policy', $3)`,
          [candidate.listing_id, candidate.market_status, occurredAt],
        );
      }

      return candidates.rowCount;
    });
  }
}
