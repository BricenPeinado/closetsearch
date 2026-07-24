import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";

interface MatchCandidateRow extends QueryResultRow {
  watchlist_id: string;
  user_id: string;
  query_text: string | null;
  canonical_brand_id: string | null;
  brand_text: string | null;
  category: string | null;
  source_marketplace: string | null;
  listing_type: string | null;
  market_status: string | null;
  min_price_minor: string | number | bigint | null;
  max_price_minor: string | number | bigint | null;
  price_currency: string | null;
  size: string | null;
  condition: string | null;
  frequency: "daily" | "hourly" | "instant" | "weekly";
  listing_title: string;
  listing_brand_id: string | null;
  listing_provider_brand: string | null;
  listing_category: string | null;
  listing_source: string;
  listing_provider_id: string;
  listing_type_value: string;
  listing_market_status: string;
  listing_original_price_minor: string | number | bigint;
  listing_original_currency: string;
  listing_comparison_price_minor: string | number | bigint | null;
  listing_comparison_currency: string | null;
  listing_size: string | null;
  listing_condition: string | null;
}

interface AlertMatchRow extends QueryResultRow {
  id: string;
  user_id: string;
  watchlist_id: string;
  listing_id: string;
  state: "dismissed" | "seen" | "unseen";
  match_reasons: unknown;
  first_matched_at: Date | string;
  last_matched_at: Date | string;
  seen_at: Date | string | null;
  dismissed_at: Date | string | null;
}

interface PreferencesRow extends QueryResultRow {
  in_app_enabled: boolean;
  email_enabled: boolean;
  frequency: "daily" | "hourly" | "instant" | "weekly";
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  normalized_email: string | null;
}

interface AlertDeliveryRow extends QueryResultRow {
  id: string;
  alert_match_id: string;
  channel: "email" | "in_app";
  destination_hash: string | null;
  idempotency_key: string;
  status:
    "dead_letter" | "delivered" | "failed" | "processing" | "queued" | "retry_wait" | "suppressed";
  attempt_count: number;
  next_attempt_at: Date | string;
  last_attempt_at: Date | string | null;
  delivered_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  provider_message_id: string | null;
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function matchesText(expected: string | null, actual: string | null) {
  return !expected || normalize(expected) === normalize(actual);
}

function candidatePrice(row: MatchCandidateRow) {
  if (
    row.price_currency &&
    row.listing_comparison_currency === row.price_currency &&
    row.listing_comparison_price_minor !== null
  ) {
    return BigInt(row.listing_comparison_price_minor);
  }

  if (!row.price_currency || row.listing_original_currency === row.price_currency) {
    return BigInt(row.listing_original_price_minor);
  }

  return undefined;
}

function evaluateCandidate(row: MatchCandidateRow) {
  const reasons: Array<{ code: string; label: string }> = [];

  if (
    row.query_text &&
    !normalize(
      [row.listing_title, row.listing_provider_brand, row.listing_category].join(" "),
    ).includes(normalize(row.query_text))
  ) {
    return undefined;
  }

  if (row.query_text) {
    reasons.push({ code: "query_match", label: "Search text matched" });
  }

  if (row.canonical_brand_id && row.canonical_brand_id !== row.listing_brand_id) {
    return undefined;
  }

  if (row.canonical_brand_id) {
    reasons.push({ code: "brand_match", label: "Brand matched" });
  }

  if (
    !row.canonical_brand_id &&
    row.brand_text &&
    normalize(row.brand_text) !== normalize(row.listing_provider_brand)
  ) {
    return undefined;
  }

  if (!row.canonical_brand_id && row.brand_text) {
    reasons.push({ code: "brand_match", label: "Brand matched" });
  }

  if (!matchesText(row.category, row.listing_category)) {
    return undefined;
  }

  if (row.category) {
    reasons.push({ code: "category_match", label: "Category matched" });
  }

  if (
    row.source_marketplace &&
    normalize(row.source_marketplace) !== normalize(row.listing_source) &&
    normalize(row.source_marketplace) !== normalize(row.listing_provider_id)
  ) {
    return undefined;
  }

  if (row.source_marketplace) {
    reasons.push({ code: "source_match", label: "Marketplace matched" });
  }

  if (row.listing_type && row.listing_type !== row.listing_type_value) {
    return undefined;
  }

  if (row.market_status && row.market_status !== row.listing_market_status) {
    return undefined;
  }

  if (!matchesText(row.size, row.listing_size)) {
    return undefined;
  }

  if (!matchesText(row.condition, row.listing_condition)) {
    return undefined;
  }

  const price = candidatePrice(row);

  if ((row.min_price_minor !== null || row.max_price_minor !== null) && price === undefined) {
    return undefined;
  }

  if (price !== undefined && row.min_price_minor !== null && price < BigInt(row.min_price_minor)) {
    return undefined;
  }

  if (price !== undefined && row.max_price_minor !== null && price > BigInt(row.max_price_minor)) {
    return undefined;
  }

  if (row.min_price_minor !== null || row.max_price_minor !== null) {
    reasons.push({ code: "price_match", label: "Price range matched" });
  }

  if (reasons.length === 0) {
    reasons.push({ code: "criteria_match", label: "Watchlist criteria matched" });
  }

  return reasons;
}

function parseMinutes(value: string | null) {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{2}):(\d{2})/.exec(value);

  if (!match) {
    return undefined;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function localMinutes(at: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: timezone,
  });
  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);

  return (hour % 24) * 60 + minute;
}

export function nextAllowedDeliveryAt(
  at: Date,
  input: {
    frequency: "daily" | "hourly" | "instant" | "weekly";
    lastDeliveredAt?: Date;
    quietHoursEnd?: string | null;
    quietHoursStart?: string | null;
    timezone: string;
  },
) {
  const frequencyMs = {
    instant: 0,
    hourly: 3_600_000,
    daily: 86_400_000,
    weekly: 604_800_000,
  }[input.frequency];
  let next = input.lastDeliveredAt
    ? new Date(Math.max(at.getTime(), input.lastDeliveredAt.getTime() + frequencyMs))
    : new Date(at);
  const start = parseMinutes(input.quietHoursStart ?? null);
  const end = parseMinutes(input.quietHoursEnd ?? null);

  if (start === undefined || end === undefined || start === end) {
    return next;
  }

  const current = localMinutes(next, input.timezone);
  const inQuietHours =
    start < end ? current >= start && current < end : current >= start || current < end;

  if (!inQuietHours) {
    return next;
  }

  const minutesUntilEnd = start < end || current < end ? end - current : 1_440 - current + end;
  next = new Date(next.getTime() + minutesUntilEnd * 60_000 + 1_000);

  return next;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function hashDestination(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mapDelivery(row: AlertDeliveryRow) {
  return {
    alertMatchId: row.alert_match_id,
    attemptCount: Number(row.attempt_count),
    channel: row.channel,
    deliveredAt: row.delivered_at ? toDate(row.delivered_at) : undefined,
    destinationHash: row.destination_hash ?? undefined,
    errorCode: row.last_error_code ?? undefined,
    errorMessage: row.last_error_message ?? undefined,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    lastAttemptAt: row.last_attempt_at ? toDate(row.last_attempt_at) : undefined,
    nextAttemptAt: toDate(row.next_attempt_at),
    providerMessageId: row.provider_message_id ?? undefined,
    status: row.status,
  };
}

function deliveryColumns() {
  return `
    id,
    alert_match_id,
    channel,
    destination_hash,
    idempotency_key,
    status,
    attempt_count,
    next_attempt_at,
    last_attempt_at,
    delivered_at,
    last_error_code,
    last_error_message,
    provider_message_id
  `;
}

export class AlertRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async matchListing(listingId: string, matchedAt: Date) {
    return this.database.withTransaction(async (client) => {
      const candidateResult = await client.query<MatchCandidateRow>(
        `SELECT
           w.id AS watchlist_id,
           w.user_id,
           w.query_text,
           w.canonical_brand_id,
           w.brand_text,
           w.category,
           w.source_marketplace,
           w.listing_type,
           w.market_status,
           w.min_price_minor,
           w.max_price_minor,
           w.price_currency,
           w.size,
           w.condition,
           w.frequency,
           l.title AS listing_title,
           l.canonical_brand_id AS listing_brand_id,
           l.provider_brand AS listing_provider_brand,
           l.category AS listing_category,
           l.source_marketplace AS listing_source,
           l.provider_id AS listing_provider_id,
           l.listing_type AS listing_type_value,
           s.market_status AS listing_market_status,
           l.original_price_minor AS listing_original_price_minor,
           l.original_currency AS listing_original_currency,
           l.comparison_price_minor AS listing_comparison_price_minor,
           l.comparison_currency AS listing_comparison_currency,
           l.size AS listing_size,
           l.condition AS listing_condition
         FROM listings l
         JOIN listing_current_state s ON s.listing_id = l.id
         JOIN watchlists w ON w.enabled = TRUE
         WHERE l.id = $1`,
        [listingId],
      );
      let matchesCreated = 0;

      for (const candidate of candidateResult.rows) {
        const reasons = evaluateCandidate(candidate);

        if (!reasons) {
          continue;
        }

        const matchId = randomUUID();
        const matchResult = await client.query<AlertMatchRow>(
          `INSERT INTO alert_matches (
             id,
             user_id,
             watchlist_id,
             listing_id,
             state,
             match_reasons,
             first_matched_at,
             last_matched_at
           ) VALUES ($1, $2, $3, $4, 'unseen', $5::jsonb, $6, $6)
           ON CONFLICT (watchlist_id, listing_id) DO UPDATE SET
             match_reasons = EXCLUDED.match_reasons,
             last_matched_at = GREATEST(
               alert_matches.last_matched_at,
               EXCLUDED.last_matched_at
             )
           RETURNING
             id,
             user_id,
             watchlist_id,
             listing_id,
             state,
             match_reasons,
             first_matched_at,
             last_matched_at,
             seen_at,
             dismissed_at`,
          [
            matchId,
            candidate.user_id,
            candidate.watchlist_id,
            listingId,
            JSON.stringify(reasons),
            matchedAt,
          ],
        );
        const storedMatch = matchResult.rows[0];
        const preferences = await client.query<PreferencesRow>(
          `SELECT
             COALESCE(p.in_app_enabled, TRUE) AS in_app_enabled,
             COALESCE(p.email_enabled, FALSE) AS email_enabled,
             COALESCE(p.frequency, $2) AS frequency,
             p.quiet_hours_start,
             p.quiet_hours_end,
             COALESCE(p.timezone, 'UTC') AS timezone,
             i.normalized_email
           FROM users u
           LEFT JOIN notification_preferences p ON p.user_id = u.id
           LEFT JOIN user_identities i
             ON i.user_id = u.id
            AND i.identity_type = 'email'
            AND i.verified_at IS NOT NULL
           WHERE u.id = $1
           LIMIT 1`,
          [candidate.user_id, candidate.frequency],
        );
        const preference = preferences.rows[0];

        if (preference?.in_app_enabled) {
          await client.query(
            `INSERT INTO alert_deliveries (
               id,
               alert_match_id,
               channel,
               idempotency_key,
               status,
               attempt_count,
               next_attempt_at,
               last_attempt_at,
               delivered_at
             ) VALUES (
               $1, $2, 'in_app', $3, 'delivered', 1, $4, $4, $4
             )
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              randomUUID(),
              storedMatch.id,
              `in_app:${candidate.watchlist_id}:${listingId}`,
              matchedAt,
            ],
          );
        }

        if (preference?.email_enabled && preference.normalized_email) {
          const previousResult = await client.query<{
            delivered_at: Date | string;
          }>(
            `SELECT d.delivered_at
             FROM alert_deliveries d
             JOIN alert_matches m ON m.id = d.alert_match_id
             WHERE m.watchlist_id = $1
               AND d.channel = 'email'
               AND d.status = 'delivered'
             ORDER BY d.delivered_at DESC
             LIMIT 1`,
            [candidate.watchlist_id],
          );
          const nextAttemptAt = nextAllowedDeliveryAt(matchedAt, {
            frequency: preference.frequency,
            lastDeliveredAt: previousResult.rows[0]?.delivered_at
              ? toDate(previousResult.rows[0].delivered_at)
              : undefined,
            quietHoursEnd: preference.quiet_hours_end,
            quietHoursStart: preference.quiet_hours_start,
            timezone: preference.timezone,
          });

          await client.query(
            `INSERT INTO alert_deliveries (
               id,
               alert_match_id,
               channel,
               destination_hash,
               idempotency_key,
               status,
               next_attempt_at
             ) VALUES ($1, $2, 'email', $3, $4, 'queued', $5)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              randomUUID(),
              storedMatch.id,
              hashDestination(preference.normalized_email),
              `email:${candidate.watchlist_id}:${listingId}`,
              nextAttemptAt,
            ],
          );
        }

        matchesCreated += 1;
      }

      return matchesCreated;
    });
  }

  async markSeen(userId: string, matchId: string, seenAt: Date) {
    const result = await this.database.query(
      `UPDATE alert_matches
       SET state = CASE
             WHEN state = 'dismissed' THEN state
             ELSE 'seen'
           END,
           seen_at = COALESCE(seen_at, $3)
       WHERE id = $1 AND user_id = $2`,
      [matchId, userId, seenAt],
    );

    return result.rowCount === 1;
  }

  async dismiss(userId: string, matchId: string, dismissedAt: Date) {
    const result = await this.database.query(
      `UPDATE alert_matches
       SET state = 'dismissed',
           dismissed_at = COALESCE(dismissed_at, $3)
       WHERE id = $1 AND user_id = $2`,
      [matchId, userId, dismissedAt],
    );

    return result.rowCount === 1;
  }

  async listInbox(userId: string) {
    const result = await this.database.query<AlertMatchRow>(
      `SELECT
         id,
         user_id,
         watchlist_id,
         listing_id,
         state,
         match_reasons,
         first_matched_at,
         last_matched_at,
         seen_at,
         dismissed_at
       FROM alert_matches
       WHERE user_id = $1
       ORDER BY last_matched_at DESC, id`,
      [userId],
    );

    return result.rows.map((row) => ({
      dismissedAt: row.dismissed_at ? toDate(row.dismissed_at) : undefined,
      firstMatchedAt: toDate(row.first_matched_at),
      id: row.id,
      lastMatchedAt: toDate(row.last_matched_at),
      listingId: row.listing_id,
      reasons:
        typeof row.match_reasons === "string" ? JSON.parse(row.match_reasons) : row.match_reasons,
      seenAt: row.seen_at ? toDate(row.seen_at) : undefined,
      state: row.state,
      userId: row.user_id,
      watchlistId: row.watchlist_id,
    }));
  }

  async claimDueDelivery(now: Date) {
    const result = await this.database.query<AlertDeliveryRow>(
      `UPDATE alert_deliveries
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           last_attempt_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id
         FROM alert_deliveries
         WHERE status IN ('queued', 'retry_wait')
           AND next_attempt_at <= $1
         ORDER BY next_attempt_at, attempt_count, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
         AND status IN ('queued', 'retry_wait')
         AND next_attempt_at <= $1
       RETURNING ${deliveryColumns()}`,
      [now],
    );

    return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
  }

  async markDeliveryDelivered(deliveryId: string, deliveredAt: Date, providerMessageId?: string) {
    const result = await this.database.query<AlertDeliveryRow>(
      `UPDATE alert_deliveries
       SET status = 'delivered',
           delivered_at = $2,
           provider_message_id = $3,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing'
       RETURNING ${deliveryColumns()}`,
      [deliveryId, deliveredAt, providerMessageId ?? null],
    );

    return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
  }

  async failDelivery(
    deliveryId: string,
    input: {
      errorCode: string;
      errorMessage: string;
      failedAt: Date;
      maxAttempts?: number;
      retryAt: Date;
      terminal?: boolean;
    },
  ) {
    return this.database.withTransaction(async (client) => {
      const current = await client.query<AlertDeliveryRow>(
        `SELECT ${deliveryColumns()}
         FROM alert_deliveries
         WHERE id = $1
         FOR UPDATE`,
        [deliveryId],
      );
      const delivery = current.rows[0];

      if (!delivery || delivery.status !== "processing") {
        return undefined;
      }

      const deadLetter =
        input.terminal || Number(delivery.attempt_count) >= (input.maxAttempts ?? 5);
      const result = await client.query<AlertDeliveryRow>(
        `UPDATE alert_deliveries
         SET status = $2,
             next_attempt_at = $3,
             last_attempt_at = $4,
             last_error_code = $5,
             last_error_message = $6,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'processing'
         RETURNING ${deliveryColumns()}`,
        [
          deliveryId,
          deadLetter ? "dead_letter" : "retry_wait",
          input.retryAt,
          input.failedAt,
          input.errorCode,
          input.errorMessage.slice(0, 2_000),
        ],
      );

      return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
    });
  }

  async suppressDelivery(deliveryId: string, reason: string) {
    const result = await this.database.query(
      `UPDATE alert_deliveries
       SET status = 'suppressed',
           last_error_code = 'suppressed',
           last_error_message = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND status IN ('queued', 'retry_wait')`,
      [deliveryId, reason.slice(0, 2_000)],
    );

    return result.rowCount === 1;
  }
}
