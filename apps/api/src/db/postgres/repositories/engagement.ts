import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";
import type { EngagementEventInput } from "../model.js";

interface AggregateRow extends QueryResultRow {
  conversion_count: string | number | bigint;
  event_date: Date | string;
  hide_count: string | number | bigint;
  like_count: string | number | bigint;
  listing_id: string;
  open_count: string | number | bigint;
  unique_session_count: string | number | bigint;
  unlike_count: string | number | bigint;
  view_count: string | number | bigint;
}

interface UserListingScoreRow extends QueryResultRow {
  provider_id: string;
  score: string | number;
  source_listing_id: string;
}

export class EngagementRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async record(input: EngagementEventInput) {
    const existing = await this.database.query(
      "SELECT event_id FROM engagement_events WHERE event_id = $1",
      [input.eventId],
    );

    if (existing.rows.length > 0) {
      return {
        duplicate: true,
        recorded: false,
      };
    }

    const result = await this.database.query(
      `INSERT INTO engagement_events (
         event_id,
         user_id,
         privacy_session_hash,
         event_type,
         listing_id,
         request_id,
         ranked_position,
         viewport_duration_ms,
         search_query_hash,
         properties,
         occurred_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11
       )
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        input.eventId,
        input.userId ?? null,
        input.privacySessionHash,
        input.eventType,
        input.listingId ?? null,
        input.requestId ?? null,
        input.rankedPosition ?? null,
        input.viewportDurationMs ?? null,
        input.searchQueryHash ?? null,
        JSON.stringify(input.properties ?? {}),
        input.occurredAt,
      ],
    );

    return {
      duplicate: result.rows.length === 0,
      recorded: result.rows.length === 1,
    };
  }

  async rollupDay(day: Date) {
    const start = new Date(day);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const eventDate = start.toISOString().slice(0, 10);

    return this.database.withTransaction(async (client) => {
      await client.query("DELETE FROM listing_engagement_daily WHERE event_date = $1", [eventDate]);
      const result = await client.query(
        `INSERT INTO listing_engagement_daily (
           listing_id,
           event_date,
           view_count,
           open_count,
           like_count,
           unlike_count,
           hide_count,
           conversion_count,
           unique_session_count
         )
         SELECT
           listing_id,
           $1::date,
           SUM(CASE WHEN event_type = 'listing_view' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'listing_open' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'unlike' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'hide' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END),
           COUNT(DISTINCT privacy_session_hash)
         FROM engagement_events
         WHERE occurred_at >= $2
           AND occurred_at < $3
           AND listing_id IS NOT NULL
         GROUP BY listing_id`,
        [eventDate, start, end],
      );

      await client.query("DELETE FROM user_listing_engagement_daily WHERE event_date = $1", [
        eventDate,
      ]);
      await client.query(
        `INSERT INTO user_listing_engagement_daily (
           user_id,
           listing_id,
           event_date,
           view_count,
           open_count,
           like_count,
           unlike_count,
           hide_count,
           conversion_count
         )
         SELECT
           user_id,
           listing_id,
           $1::date,
           SUM(CASE WHEN event_type = 'listing_view' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'listing_open' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'unlike' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'hide' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END)
         FROM engagement_events
         WHERE occurred_at >= $2
           AND occurred_at < $3
           AND user_id IS NOT NULL
           AND listing_id IS NOT NULL
         GROUP BY user_id, listing_id`,
        [eventDate, start, end],
      );

      return result.rowCount;
    });
  }

  async getUserListingScores(userId: string, since: Date): Promise<Map<string, number>> {
    const result = await this.database.query<UserListingScoreRow>(
      `SELECT
         l.provider_id,
         l.source_listing_id,
         SUM(
           feature.view_count * 0.25
           + feature.open_count * 1.5
           + feature.like_count * 3
           - feature.unlike_count * 3
           - feature.hide_count * 4
           + feature.conversion_count * 5
         )::double precision AS score
       FROM user_listing_engagement_daily feature
       JOIN listings l ON l.id = feature.listing_id
       WHERE feature.user_id = $1
         AND feature.event_date >= $2::date
       GROUP BY l.provider_id, l.source_listing_id`,
      [userId, since],
    );

    return new Map(
      result.rows.map((row) => [`${row.provider_id}:${row.source_listing_id}`, Number(row.score)]),
    );
  }

  async getDailyAggregate(listingId: string, day: Date) {
    const eventDate = day.toISOString().slice(0, 10);
    const result = await this.database.query<AggregateRow>(
      `SELECT
         listing_id,
         event_date,
         view_count,
         open_count,
         like_count,
         unlike_count,
         hide_count,
         conversion_count,
         unique_session_count
       FROM listing_engagement_daily
       WHERE listing_id = $1 AND event_date = $2`,
      [listingId, eventDate],
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return {
      conversionCount: BigInt(row.conversion_count),
      date: String(row.event_date).slice(0, 10),
      hideCount: BigInt(row.hide_count),
      likeCount: BigInt(row.like_count),
      listingId: row.listing_id,
      openCount: BigInt(row.open_count),
      uniqueSessionCount: BigInt(row.unique_session_count),
      unlikeCount: BigInt(row.unlike_count),
      viewCount: BigInt(row.view_count),
    };
  }

  async deleteEventsBefore(cutoff: Date, limit = 5_000) {
    const result = await this.database.query(
      `DELETE FROM engagement_events
       WHERE event_id IN (
         SELECT event_id
         FROM engagement_events
         WHERE received_at < $1
         ORDER BY received_at, event_id
         LIMIT $2
       )`,
      [cutoff, limit],
    );

    return result.rowCount;
  }
}
