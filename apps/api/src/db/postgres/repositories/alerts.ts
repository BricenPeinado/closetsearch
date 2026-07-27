import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";
import type { PgQueryable } from "../types.js";
import { hashNotificationDestination } from "./notifications.js";

interface MatchCandidateRow extends QueryResultRow {
  alert_email_enabled: boolean;
  alert_event_types: unknown;
  alert_in_app_enabled: boolean;
  alert_sms_enabled: boolean;
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
  listing_source_url: string;
  listing_brand_id: string | null;
  listing_provider_brand: string | null;
  listing_category: string | null;
  listing_source: string;
  listing_provider_id: string;
  listing_source_listing_id: string;
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
  event_context: unknown;
  event_type:
    "auction_ending" | "back_in_range" | "digest" | "new_listing" | "price_drop" | "security";
}

interface PreferencesRow extends QueryResultRow {
  in_app_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  frequency: "daily" | "hourly" | "instant" | "weekly";
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  normalized_email: string | null;
  phone_e164: string | null;
}

interface AlertDeliveryRow extends QueryResultRow {
  id: string;
  alert_match_id: string;
  channel: "email" | "in_app" | "sms";
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
  provider_delivery_status: string | null;
  provider_status_rank: number;
  claimed_at: Date | string | null;
  event_type: AlertMatchRow["event_type"];
  payload: unknown;
  provider_response: unknown;
  template_key: string;
}

interface RecentPriceRow extends QueryResultRow {
  analytics_eligible: boolean;
  auction_ends_at: Date | string | null;
  completed_auction_currency: string | null;
  completed_auction_price_minor: string | number | bigint | null;
  comparison_currency: string | null;
  comparison_price_minor: string | number | bigint | null;
  current_bid_currency: string | null;
  current_bid_minor: string | number | bigint | null;
  observation_kind: "asking" | "completed_auction" | "confirmed_sold" | "current_bid";
  observation_version: string | number | bigint;
  original_currency: string;
  original_price_minor: string | number | bigint;
  sold_currency: string | null;
  sold_price_minor: string | number | bigint | null;
}

interface DeliveryContextRow extends QueryResultRow {
  alert_email_enabled: boolean;
  alert_event_types: unknown;
  alert_sms_enabled: boolean;
  destination: string | null;
  email_enabled: boolean;
  frequency: "daily" | "hourly" | "instant" | "weekly";
  quiet_hours_end: string | null;
  quiet_hours_start: string | null;
  sms_enabled: boolean;
  timezone: string;
  user_id: string;
  watchlist_id: string;
  listing_analytics_eligible: boolean;
  listing_availability: string;
  listing_market_status: string;
  listing_provider_id: string;
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

type MatchEventType = AlertMatchRow["event_type"];

function configuredEventTypes(value: unknown) {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return new Set(
    Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is MatchEventType =>
            entry === "new_listing" ||
            entry === "price_drop" ||
            entry === "auction_ending" ||
            entry === "back_in_range",
        )
      : [],
  );
}

function evidenceMoney(row: RecentPriceRow | undefined) {
  if (!row) {
    return undefined;
  }

  switch (row.observation_kind) {
    case "current_bid":
      return {
        amount: BigInt(row.current_bid_minor ?? row.original_price_minor),
        currency: row.current_bid_currency ?? row.original_currency,
      };
    case "completed_auction":
      return row.completed_auction_price_minor !== null || row.sold_price_minor !== null
        ? {
            amount: BigInt(
              row.completed_auction_price_minor ??
                (row.sold_price_minor as string | number | bigint),
            ),
            currency: row.completed_auction_currency ?? row.sold_currency ?? row.original_currency,
          }
        : undefined;
    case "confirmed_sold":
      return row.sold_price_minor === null
        ? undefined
        : {
            amount: BigInt(row.sold_price_minor),
            currency: row.sold_currency ?? row.original_currency,
          };
    case "asking":
      return {
        amount: BigInt(row.original_price_minor),
        currency: row.original_currency,
      };
  }
}

function listingEvents(
  prices: RecentPriceRow[],
  matchedAt: Date,
  hasNewListingMatch: boolean,
  candidate: MatchCandidateRow,
) {
  const events: MatchEventType[] = [];
  const latest = prices[0];
  const previous = prices[1];
  const latestMoney = evidenceMoney(latest);
  const previousMoney = evidenceMoney(previous);

  if (!hasNewListingMatch) {
    events.push("new_listing");
  }
  if (
    latestMoney &&
    previousMoney &&
    latestMoney.currency === previousMoney.currency &&
    latestMoney.amount < previousMoney.amount
  ) {
    events.push("price_drop");
  }
  const watchlistMoney = (row: RecentPriceRow | undefined) => {
    if (!row) {
      return undefined;
    }
    if (
      candidate.price_currency &&
      row.comparison_currency === candidate.price_currency &&
      row.comparison_price_minor !== null
    ) {
      return {
        amount: BigInt(row.comparison_price_minor),
        currency: row.comparison_currency,
      };
    }
    const money = evidenceMoney(row);
    return money && (!candidate.price_currency || money.currency === candidate.price_currency)
      ? money
      : undefined;
  };
  const isInRange = (money: { amount: bigint; currency: string } | undefined) =>
    Boolean(
      money &&
      (candidate.min_price_minor === null || money.amount >= BigInt(candidate.min_price_minor)) &&
      (candidate.max_price_minor === null || money.amount <= BigInt(candidate.max_price_minor)),
    );
  const latestWatchlistMoney = watchlistMoney(latest);
  const previousWatchlistMoney = watchlistMoney(previous);

  if (
    (candidate.min_price_minor !== null || candidate.max_price_minor !== null) &&
    isInRange(latestWatchlistMoney) &&
    previousWatchlistMoney &&
    !isInRange(previousWatchlistMoney)
  ) {
    events.push("back_in_range");
  }
  if (latest?.observation_kind === "current_bid" && latest.auction_ends_at) {
    const endsAt = new Date(latest.auction_ends_at);
    const remainingMs = endsAt.getTime() - matchedAt.getTime();

    if (remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1_000) {
      events.push("auction_ending");
    }
  }

  return events;
}

function deliveryTriggerIdentity(
  eventType: MatchEventType,
  listingId: string,
  latestPrice: RecentPriceRow | undefined,
) {
  if (eventType === "new_listing") {
    return `listing:${listingId}`;
  }
  if (eventType === "auction_ending" && latestPrice?.auction_ends_at) {
    return `auction-end:${new Date(latestPrice.auction_ends_at).toISOString()}`;
  }
  return `observation:${String(latestPrice?.observation_version ?? 0)}`;
}

async function channelState(client: PgQueryable, channel: "email" | "sms", destination: string) {
  const destinationHash = hashDestination(destination);
  const [suppression, consent] = await Promise.all([
    client.query(
      `SELECT id
       FROM notification_suppressions
       WHERE channel = $1
         AND destination_hash = $2
         AND released_at IS NULL
       LIMIT 1`,
      [channel, destinationHash],
    ),
    client.query<{ action: "opt_in" | "opt_out" }>(
      `SELECT action
       FROM notification_channel_consents
       WHERE channel = $1
         AND destination_hash = $2
       ORDER BY
         occurred_at DESC,
         CASE WHEN action = 'opt_out' THEN 1 ELSE 0 END DESC,
         id DESC
       LIMIT 1`,
      [channel, destinationHash],
    ),
  ]);

  return {
    consent: consent.rows[0]?.action,
    destinationHash,
    suppressed: suppression.rows.length > 0,
  };
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

function localDateTime(at: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
    hour: hour % 24,
    minute,
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
    year: Number(parts.find((part) => part.type === "year")?.value ?? 1970),
  };
}

function quietHoursEndInstant(
  currentInstant: Date,
  endMinutes: number,
  timezone: string,
  nextLocalDay: boolean,
) {
  const currentLocal = localDateTime(currentInstant, timezone);
  const localCalendar = new Date(
    Date.UTC(currentLocal.year, currentLocal.month - 1, currentLocal.day + (nextLocalDay ? 1 : 0)),
  );
  const target = {
    day: localCalendar.getUTCDate(),
    hour: Math.floor(endMinutes / 60),
    minute: endMinutes % 60,
    month: localCalendar.getUTCMonth() + 1,
    year: localCalendar.getUTCFullYear(),
  };
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );
  const currentAsUtc = Date.UTC(
    currentLocal.year,
    currentLocal.month - 1,
    currentLocal.day,
    currentLocal.hour,
    currentLocal.minute,
  );
  const initialOffset = currentAsUtc - currentInstant.getTime();
  const initialGuess = targetAsUtc - initialOffset;
  const exact: number[] = [];
  const afterGap: number[] = [];

  // Around a DST transition the offset can move by 30, 60, or 120 minutes.
  // Checking both sides also lets us choose the later occurrence of an
  // ambiguous wall time, so quiet hours do not end during the repeated hour.
  for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes += 15) {
    const candidate = initialGuess + deltaMinutes * 60_000;
    const local = localDateTime(new Date(candidate), timezone);
    const sameDate =
      local.year === target.year && local.month === target.month && local.day === target.day;

    if (!sameDate) {
      continue;
    }
    const candidateMinutes = local.hour * 60 + local.minute;

    if (candidateMinutes === endMinutes) {
      exact.push(candidate);
    } else if (candidateMinutes > endMinutes) {
      afterGap.push(candidate);
    }
  }

  const resolved =
    exact.length > 0
      ? Math.max(...exact)
      : afterGap.length > 0
        ? Math.min(...afterGap)
        : initialGuess;
  return new Date(resolved + 1_000);
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

  const current = localDateTime(next, input.timezone);
  const currentMinutes = current.hour * 60 + current.minute;
  const inQuietHours =
    start < end
      ? currentMinutes >= start && currentMinutes < end
      : currentMinutes >= start || currentMinutes < end;

  if (!inQuietHours) {
    return next;
  }

  next = quietHoursEndInstant(next, end, input.timezone, start > end && currentMinutes >= start);

  return next;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function hashDestination(value: string) {
  return hashNotificationDestination(value);
}

function mapDelivery(row: AlertDeliveryRow) {
  return {
    alertMatchId: row.alert_match_id,
    attemptCount: Number(row.attempt_count),
    channel: row.channel,
    claimedAt: row.claimed_at ? toDate(row.claimed_at) : undefined,
    deliveredAt: row.delivered_at ? toDate(row.delivered_at) : undefined,
    destinationHash: row.destination_hash ?? undefined,
    errorCode: row.last_error_code ?? undefined,
    errorMessage: row.last_error_message ?? undefined,
    eventType: row.event_type,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    lastAttemptAt: row.last_attempt_at ? toDate(row.last_attempt_at) : undefined,
    nextAttemptAt: toDate(row.next_attempt_at),
    providerMessageId: row.provider_message_id ?? undefined,
    providerDeliveryStatus: row.provider_delivery_status ?? undefined,
    providerStatusRank: Number(row.provider_status_rank),
    providerResponse:
      typeof row.provider_response === "string"
        ? JSON.parse(row.provider_response)
        : (row.provider_response ?? undefined),
    status: row.status,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    templateKey: row.template_key,
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
    provider_message_id,
    provider_delivery_status,
    provider_status_rank,
    claimed_at,
    event_type,
    template_key,
    payload,
    provider_response
  `;
}

function smsProviderStatusRank(status: string) {
  return {
    accepted: 10,
    queued: 20,
    sending: 30,
    sent: 40,
    failed: 50,
    undelivered: 50,
    delivered: 60,
  }[status];
}

export class AlertRepository {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly options: {
      useSkipLocked?: boolean;
    } = {},
  ) {}

  async matchListing(listingId: string, matchedAt: Date, providerAuthorized = false) {
    if (!providerAuthorized) {
      return 0;
    }

    return this.database.withTransaction(async (client) => {
      const recentPrices = await client.query<RecentPriceRow>(
        `SELECT
           observation_version,
           analytics_eligible,
           observation_kind,
           original_price_minor,
           original_currency,
           comparison_price_minor,
           comparison_currency,
           sold_price_minor,
           sold_currency,
           current_bid_minor,
           current_bid_currency,
           completed_auction_price_minor,
           completed_auction_currency,
           auction_ends_at
         FROM price_observations
         WHERE listing_id = $1
           AND analytics_eligible = TRUE
         ORDER BY observation_version DESC
         LIMIT 2`,
        [listingId],
      );
      const candidateResult = await client.query<MatchCandidateRow>(
        `SELECT
           w.id AS watchlist_id,
           w.user_id,
           w.alert_event_types,
           w.alert_in_app_enabled,
           w.alert_email_enabled,
           w.alert_sms_enabled,
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
           l.source_url AS listing_source_url,
           l.canonical_brand_id AS listing_brand_id,
           l.provider_brand AS listing_provider_brand,
           l.category AS listing_category,
           l.source_marketplace AS listing_source,
           l.provider_id AS listing_provider_id,
           l.source_listing_id AS listing_source_listing_id,
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
         WHERE l.id = $1
           AND l.analytics_eligible = TRUE
           AND l.provider_id <> 'mock'
           AND s.availability = 'available'
           AND s.market_status = 'active'`,
        [listingId],
      );
      let matchesCreated = 0;

      for (const candidate of candidateResult.rows) {
        const reasons = evaluateCandidate(candidate);

        if (!reasons) {
          continue;
        }

        const priorNewListingMatch = await client.query(
          `SELECT id
           FROM alert_matches
           WHERE watchlist_id = $1
             AND listing_id = $2
             AND event_type = 'new_listing'
           LIMIT 1`,
          [candidate.watchlist_id, listingId],
        );
        const eventTypes = listingEvents(
          recentPrices.rows,
          matchedAt,
          priorNewListingMatch.rows.length > 0,
          candidate,
        ).filter((eventType) => configuredEventTypes(candidate.alert_event_types).has(eventType));

        if (eventTypes.length === 0) {
          continue;
        }

        const preferences = await client.query<PreferencesRow>(
          `SELECT
             COALESCE(p.in_app_enabled, TRUE) AS in_app_enabled,
             COALESCE(p.email_enabled, FALSE) AS email_enabled,
             COALESCE(p.sms_enabled, FALSE) AS sms_enabled,
             COALESCE(p.frequency, $2) AS frequency,
             p.quiet_hours_start,
             p.quiet_hours_end,
             COALESCE(p.timezone, 'UTC') AS timezone,
             i.normalized_email,
             phone.phone_e164
           FROM users u
           LEFT JOIN notification_preferences p ON p.user_id = u.id
           LEFT JOIN user_identities i
             ON i.user_id = u.id
            AND i.identity_type = 'email'
            AND i.verified_at IS NOT NULL
           LEFT JOIN user_phone_identities phone
             ON phone.user_id = u.id
            AND phone.verified_at IS NOT NULL
            AND phone.disabled_at IS NULL
           WHERE u.id = $1
           LIMIT 1`,
          [candidate.user_id, candidate.frequency],
        );
        const preference = preferences.rows[0];
        const emailState = preference?.normalized_email
          ? await channelState(client, "email", preference.normalized_email)
          : undefined;
        const smsState = preference?.phone_e164
          ? await channelState(client, "sms", preference.phone_e164)
          : undefined;
        const latestMoney = evidenceMoney(recentPrices.rows[0]);

        for (const eventType of eventTypes) {
          const triggerIdentity = deliveryTriggerIdentity(
            eventType,
            listingId,
            recentPrices.rows[0],
          );
          const eventContext = {
            amountMinor: latestMoney?.amount.toString(),
            currency: latestMoney?.currency,
            marketplace: candidate.listing_source,
            publicListingId: `${candidate.listing_provider_id}:${candidate.listing_source_listing_id}`,
            observationVersion: String(recentPrices.rows[0]?.observation_version ?? 0),
            auctionEndsAt: recentPrices.rows[0]?.auction_ends_at
              ? toDate(recentPrices.rows[0].auction_ends_at).toISOString()
              : undefined,
            triggerIdentity,
          };
          const matchResult = await client.query<AlertMatchRow>(
            `INSERT INTO alert_matches (
               id,
               user_id,
               watchlist_id,
               listing_id,
               event_type,
               event_context,
               state,
               match_reasons,
               first_matched_at,
               last_matched_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6::jsonb, 'unseen', $7::jsonb, $8, $8
             )
             ON CONFLICT (watchlist_id, listing_id, event_type) DO UPDATE SET
               match_reasons = EXCLUDED.match_reasons,
               state = CASE
                 WHEN COALESCE(
                   alert_matches.event_context->>'triggerIdentity',
                   ''
                 ) <> COALESCE(
                   EXCLUDED.event_context->>'triggerIdentity',
                   ''
                 ) THEN 'unseen'
                 ELSE alert_matches.state
               END,
               seen_at = CASE
                 WHEN COALESCE(
                   alert_matches.event_context->>'triggerIdentity',
                   ''
                 ) <> COALESCE(
                   EXCLUDED.event_context->>'triggerIdentity',
                   ''
                 ) THEN NULL
                 ELSE alert_matches.seen_at
               END,
               dismissed_at = CASE
                 WHEN COALESCE(
                   alert_matches.event_context->>'triggerIdentity',
                   ''
                 ) <> COALESCE(
                   EXCLUDED.event_context->>'triggerIdentity',
                   ''
                 ) THEN NULL
                 ELSE alert_matches.dismissed_at
               END,
               event_context = EXCLUDED.event_context,
               last_matched_at = GREATEST(
                 alert_matches.last_matched_at,
                 EXCLUDED.last_matched_at
               )
             RETURNING
               id,
               user_id,
               watchlist_id,
               listing_id,
               event_type,
               event_context,
               state,
               match_reasons,
               first_matched_at,
               last_matched_at,
               seen_at,
               dismissed_at`,
            [
              randomUUID(),
              candidate.user_id,
              candidate.watchlist_id,
              listingId,
              eventType,
              JSON.stringify(eventContext),
              JSON.stringify(reasons),
              matchedAt,
            ],
          );
          const storedMatch = matchResult.rows[0];
          const deliveryPayload = {
            eventType,
            listingId,
            marketplace: candidate.listing_source,
            publicListingId: `${candidate.listing_provider_id}:${candidate.listing_source_listing_id}`,
            reasons,
            sourceUrl: candidate.listing_source_url,
            title: candidate.listing_title,
            watchlistId: candidate.watchlist_id,
            triggerIdentity,
          };

          if (preference?.in_app_enabled && candidate.alert_in_app_enabled) {
            await client.query(
              `INSERT INTO alert_deliveries (
                 id,
                 alert_match_id,
                 channel,
                 event_type,
                 template_key,
                 payload,
                 idempotency_key,
                 status,
                 attempt_count,
                 next_attempt_at,
                 last_attempt_at,
                 delivered_at
               ) VALUES (
                 $1, $2, 'in_app', $3, 'watchlist_match', $4::jsonb, $5,
                 'delivered', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
               )
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [
                randomUUID(),
                storedMatch.id,
                eventType,
                JSON.stringify(deliveryPayload),
                `in_app:${candidate.watchlist_id}:${listingId}:${eventType}:${triggerIdentity}`,
              ],
            );
          }

          for (const channel of ["email", "sms"] as const) {
            const destination =
              channel === "email" ? preference?.normalized_email : preference?.phone_e164;
            const state = channel === "email" ? emailState : smsState;
            const channelEnabled =
              channel === "email"
                ? preference?.email_enabled &&
                  candidate.alert_email_enabled &&
                  state?.consent === "opt_in"
                : preference?.sms_enabled &&
                  candidate.alert_sms_enabled &&
                  state?.consent === "opt_in";

            if (!destination || !state || state.suppressed || !channelEnabled) {
              continue;
            }

            const previousResult = await client.query<{
              delivered_at: Date | string;
            }>(
              `SELECT d.delivered_at
               FROM alert_deliveries d
               JOIN alert_matches m ON m.id = d.alert_match_id
               WHERE m.watchlist_id = $1
                 AND d.channel = $2
                 AND d.status = 'delivered'
               ORDER BY d.delivered_at DESC
               LIMIT 1`,
              [candidate.watchlist_id, channel],
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
                 event_type,
                 template_key,
                 payload,
                 idempotency_key,
                 status,
                 next_attempt_at
               ) VALUES (
                 $1, $2, $3, $4, $5, 'watchlist_match', $6::jsonb,
                 $7, 'queued', $8
               )
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [
                randomUUID(),
                storedMatch.id,
                channel,
                state.destinationHash,
                eventType,
                JSON.stringify(deliveryPayload),
                `${channel}:${candidate.watchlist_id}:${listingId}:${eventType}:${triggerIdentity}`,
                nextAttemptAt,
              ],
            );
          }

          matchesCreated += 1;
        }
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
         event_type,
         event_context,
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
      eventContext:
        typeof row.event_context === "string" ? JSON.parse(row.event_context) : row.event_context,
      eventType: row.event_type,
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

  async listDeliveryStatusCounts() {
    const result = await this.database.query<{
      channel: "email" | "in_app" | "sms";
      delivery_count: string | number | bigint;
      status: AlertDeliveryRow["status"];
    }>(
      `SELECT
         channel,
         status,
         COUNT(*) AS delivery_count
       FROM alert_deliveries
       GROUP BY channel, status
       ORDER BY channel, status`,
    );

    return result.rows.map((row) => ({
      channel: row.channel,
      count: Number(row.delivery_count),
      status: row.status,
    }));
  }

  async claimDueDelivery(now: Date) {
    const lockClause =
      this.options.useSkipLocked === false ? "FOR UPDATE" : "FOR UPDATE SKIP LOCKED";
    const result = await this.database.query<AlertDeliveryRow>(
      `UPDATE alert_deliveries
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           last_attempt_at = $1,
           claimed_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id
         FROM alert_deliveries
         WHERE status IN ('queued', 'retry_wait')
           AND next_attempt_at <= $1
         ORDER BY next_attempt_at, attempt_count, id
         LIMIT 1
         ${lockClause}
       )
         AND status IN ('queued', 'retry_wait')
         AND next_attempt_at <= $1
       RETURNING ${deliveryColumns()}`,
      [now],
    );

    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    const context = await this.database.query<DeliveryContextRow>(
      `SELECT
         match.user_id,
         match.watchlist_id,
         listing.provider_id AS listing_provider_id,
         listing.analytics_eligible AS listing_analytics_eligible,
         listing_state.availability AS listing_availability,
         listing_state.market_status AS listing_market_status,
         watchlist.alert_event_types,
         watchlist.alert_email_enabled,
         watchlist.alert_sms_enabled,
         COALESCE(preference.email_enabled, FALSE) AS email_enabled,
         COALESCE(preference.sms_enabled, FALSE) AS sms_enabled,
         COALESCE(preference.frequency, watchlist.frequency) AS frequency,
         preference.quiet_hours_start,
         preference.quiet_hours_end,
         COALESCE(preference.timezone, 'UTC') AS timezone,
         CASE
           WHEN delivery.channel = 'email' THEN email.normalized_email
           WHEN delivery.channel = 'sms' THEN phone.phone_e164
           ELSE NULL
         END AS destination
       FROM alert_deliveries delivery
       JOIN alert_matches match ON match.id = delivery.alert_match_id
       JOIN watchlists watchlist ON watchlist.id = match.watchlist_id
       JOIN listings listing ON listing.id = match.listing_id
       JOIN listing_current_state listing_state
         ON listing_state.listing_id = listing.id
       LEFT JOIN notification_preferences preference
         ON preference.user_id = match.user_id
       LEFT JOIN user_identities email
         ON email.user_id = match.user_id
        AND email.identity_type = 'email'
        AND email.verified_at IS NOT NULL
       LEFT JOIN user_phone_identities phone
         ON phone.user_id = match.user_id
        AND phone.verified_at IS NOT NULL
        AND phone.disabled_at IS NULL
       WHERE delivery.id = $1
       LIMIT 1`,
      [row.id],
    );
    const deliveryHistory = context.rows[0]
      ? await this.database.query<{ delivered_at: Date | string }>(
          `SELECT previous.delivered_at
           FROM alert_deliveries previous
           JOIN alert_matches previous_match
             ON previous_match.id = previous.alert_match_id
           WHERE previous_match.watchlist_id = $1
             AND previous.channel = $2
             AND previous.status = 'delivered'
           ORDER BY previous.delivered_at DESC
           LIMIT 1`,
          [context.rows[0].watchlist_id, row.channel],
        )
      : undefined;

    return {
      ...mapDelivery(row),
      destination: context.rows[0]?.destination ?? undefined,
      deliveryPolicy: context.rows[0]
        ? {
            enabled:
              row.channel === "email"
                ? context.rows[0].email_enabled && context.rows[0].alert_email_enabled
                : row.channel === "sms"
                  ? context.rows[0].sms_enabled && context.rows[0].alert_sms_enabled
                  : false,
            eventEnabled: configuredEventTypes(context.rows[0].alert_event_types).has(
              row.event_type,
            ),
            listingEligible:
              context.rows[0].listing_analytics_eligible &&
              context.rows[0].listing_provider_id !== "mock" &&
              context.rows[0].listing_availability === "available" &&
              context.rows[0].listing_market_status === "active",
            providerId: context.rows[0].listing_provider_id,
            frequency: context.rows[0].frequency,
            lastDeliveredAt: deliveryHistory?.rows[0]?.delivered_at
              ? toDate(deliveryHistory.rows[0].delivered_at)
              : undefined,
            quietHoursEnd: context.rows[0].quiet_hours_end,
            quietHoursStart: context.rows[0].quiet_hours_start,
            timezone: context.rows[0].timezone,
          }
        : undefined,
      userId: context.rows[0]?.user_id,
    };
  }

  async deferDelivery(deliveryId: string, nextAttemptAt: Date, reason: string) {
    const result = await this.database.query(
      `UPDATE alert_deliveries
       SET status = 'retry_wait',
           attempt_count = CASE
             WHEN attempt_count > 0 THEN attempt_count - 1
             ELSE 0
           END,
           next_attempt_at = $2,
           claimed_at = NULL,
           last_error_code = 'delivery_policy_deferred',
           last_error_message = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing'`,
      [deliveryId, nextAttemptAt, reason.slice(0, 2_000)],
    );

    return result.rowCount === 1;
  }

  async recoverStaleDeliveryClaims(recoveredAt: Date, staleBefore: Date, maxAttempts = 5) {
    const result = await this.database.query(
      `UPDATE alert_deliveries
       SET status = CASE
             WHEN channel = 'sms' THEN 'failed'
             WHEN attempt_count >= $3 THEN 'dead_letter'
             ELSE 'retry_wait'
           END,
           next_attempt_at = $1,
           claimed_at = NULL,
           last_error_code = CASE
             WHEN channel = 'sms' THEN 'sms_delivery_reconciliation_required'
             ELSE 'stale_delivery_claim'
           END,
           last_error_message = CASE
             WHEN channel = 'sms'
               THEN 'SMS provider acceptance is unknown; manual reconciliation is required before retry.'
             ELSE 'A prior worker claim expired before completion.'
           END,
           updated_at = $1
       WHERE status = 'processing'
         AND claimed_at IS NOT NULL
         AND claimed_at <= $2`,
      [recoveredAt, staleBefore, maxAttempts],
    );

    return result.rowCount ?? 0;
  }

  async reconcileSmsDeliveryCallback(input: {
    deliveryId: string;
    errorCode?: string;
    messageStatus: string;
    occurredAt: Date;
    providerMessageId: string;
  }) {
    const providerStatusRank = smsProviderStatusRank(input.messageStatus);
    const failed = input.messageStatus === "failed" || input.messageStatus === "undelivered";

    if (providerStatusRank === undefined) {
      return undefined;
    }

    const result = await this.database.query<AlertDeliveryRow>(
      `UPDATE alert_deliveries
       SET status = $2,
           delivered_at = CASE
             WHEN $2 = 'delivered' THEN COALESCE(delivered_at, $3)
             ELSE delivered_at
           END,
           provider_message_id = $4,
           provider_response = $5::jsonb,
           provider_delivery_status = $8,
           provider_status_rank = $9,
           last_error_code = $6,
           last_error_message = $7,
           claimed_at = NULL,
           updated_at = GREATEST(updated_at, $3)
       WHERE id = $1
         AND channel = 'sms'
         AND (provider_message_id IS NULL OR provider_message_id = $4)
         AND provider_status_rank < $9
         AND status IN (
           'queued',
           'processing',
           'retry_wait',
           'delivered',
           'failed',
           'dead_letter'
         )
       RETURNING ${deliveryColumns()}`,
      [
        input.deliveryId,
        failed ? "failed" : "delivered",
        input.occurredAt,
        input.providerMessageId,
        JSON.stringify({ messageStatus: input.messageStatus }),
        failed
          ? input.errorCode
            ? `sms_provider_${input.errorCode}`
            : "sms_provider_failed"
          : null,
        failed ? "SMS provider reported a terminal delivery failure." : null,
        input.messageStatus,
        providerStatusRank,
      ],
    );

    return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
  }

  async markDeliveryDelivered(
    deliveryId: string,
    deliveredAt: Date,
    providerMessageId?: string,
    providerResponse?: Record<string, unknown>,
  ) {
    const providerDeliveryStatus =
      typeof providerResponse?.status === "string" &&
      smsProviderStatusRank(providerResponse.status) !== undefined
        ? providerResponse.status
        : "accepted";
    const providerStatusRank = smsProviderStatusRank(providerDeliveryStatus) ?? 10;
    const result = await this.database.query<AlertDeliveryRow>(
      `UPDATE alert_deliveries
       SET status = 'delivered',
           delivered_at = $2,
           provider_message_id = $3,
           provider_response = $4::jsonb,
           provider_delivery_status = $5,
           provider_status_rank = $6,
           claimed_at = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing'
       RETURNING ${deliveryColumns()}`,
      [
        deliveryId,
        deliveredAt,
        providerMessageId ?? null,
        providerResponse ? JSON.stringify(providerResponse) : null,
        providerDeliveryStatus,
        providerStatusRank,
      ],
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
             claimed_at = NULL,
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
           claimed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND status IN ('queued', 'retry_wait', 'processing')`,
      [deliveryId, reason.slice(0, 2_000)],
    );

    return result.rowCount === 1;
  }
}
