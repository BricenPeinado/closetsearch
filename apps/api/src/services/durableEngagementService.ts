import { createHash } from "node:crypto";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import type { EngagementEventInput, EngagementEventType } from "../db/postgres/model.js";
import { parsePublicListingId } from "../db/postgres/public-listing-id.js";
import { ApiError } from "../api-error.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedEventTypes = new Set<EngagementEventType>([
  "conversion",
  "filter_apply",
  "hide",
  "like",
  "listing_open",
  "listing_view",
  "recommendation_impression",
  "recommendation_request",
  "saved_filter",
  "saved_search",
  "search_submit",
  "unlike",
  "watchlist_create",
]);
const listingEventTypes = new Set<EngagementEventType>([
  "conversion",
  "hide",
  "like",
  "listing_open",
  "listing_view",
  "recommendation_impression",
  "unlike",
]);
const forbiddenPropertyNames = new Set([
  "authorization",
  "cookie",
  "email",
  "ip",
  "password",
  "session",
  "token",
  "useragent",
]);

export interface EngagementActor {
  privacySessionId: string;
  userId?: string;
}

export interface EngagementRuntimeConfig {
  futureToleranceMs: number;
  maxEventAgeMs: number;
  sessionPepper: string;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function getEngagementRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): EngagementRuntimeConfig {
  const sessionPepper =
    env.ENGAGEMENT_SESSION_PEPPER?.trim() ||
    (env.NODE_ENV === "production" ? "" : "closetsearch-development-engagement-pepper");

  if (env.NODE_ENV === "production" && sessionPepper.length < 32) {
    throw new Error("ENGAGEMENT_SESSION_PEPPER must contain at least 32 characters in production.");
  }

  return {
    futureToleranceMs: boundedInteger(env.ENGAGEMENT_FUTURE_TOLERANCE_MS, 300_000, 0, 3_600_000),
    maxEventAgeMs: boundedInteger(
      env.ENGAGEMENT_MAX_EVENT_AGE_MS,
      604_800_000,
      60_000,
      2_592_000_000,
    ),
    sessionPepper,
  };
}

function requiredString(payload: Record<string, unknown>, name: string, maximumLength: number) {
  const value = payload[name];

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maximumLength
  ) {
    throw new ApiError(
      400,
      "invalid_engagement_event",
      `${name} is required and must be at most ${maximumLength} characters.`,
    );
  }

  return value.trim();
}

function optionalUuid(payload: Record<string, unknown>, name: string) {
  const value = payload[name];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ApiError(400, "invalid_engagement_event", `${name} must be a UUID.`);
  }

  return value.toLowerCase();
}

function optionalPublicListingId(payload: Record<string, unknown>, name: string) {
  const value = payload[name];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiError(
      400,
      "invalid_engagement_event",
      `${name} must be a normalized public listing ID.`,
    );
  }

  const identity = parsePublicListingId(value);

  if (!identity) {
    throw new ApiError(
      400,
      "invalid_engagement_event",
      `${name} must use the normalized provider:source-listing-id format.`,
    );
  }

  return identity;
}

function sanitizeProperties(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_engagement_event", "properties must be an object.");
  }

  const entries = Object.entries(value);

  if (entries.length > 20) {
    throw new ApiError(400, "invalid_engagement_event", "properties contains too many fields.");
  }

  for (const [key] of entries) {
    if (forbiddenPropertyNames.has(key.replace(/[^a-z]/gi, "").toLowerCase())) {
      throw new ApiError(
        400,
        "sensitive_engagement_data",
        "Engagement properties must not contain secrets or direct identifiers.",
      );
    }
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > 4_096) {
    throw new ApiError(
      413,
      "engagement_event_too_large",
      "Engagement properties exceed the 4096-byte limit.",
    );
  }

  return JSON.parse(serialized) as Record<string, unknown>;
}

function hashValue(pepper: string, namespace: string, value: string) {
  return createHash("sha256")
    .update(namespace)
    .update(":")
    .update(pepper)
    .update(":")
    .update(value)
    .digest("hex");
}

export class DurableEngagementService {
  constructor(
    private readonly dataPlane: PostgresDataPlane,
    private readonly config = getEngagementRuntimeConfig(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordClientEvent(actor: EngagementActor, rawPayload: unknown) {
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      throw new ApiError(
        400,
        "invalid_engagement_event",
        "Engagement event body must be an object.",
      );
    }

    const payload = rawPayload as Record<string, unknown>;

    if ("userId" in payload || "user_id" in payload) {
      throw new ApiError(
        400,
        "spoofed_user_id",
        "User identity is derived from the authenticated session.",
      );
    }

    if (actor.userId !== undefined && !uuidPattern.test(actor.userId)) {
      throw new ApiError(401, "invalid_actor", "Authenticated user identity is invalid.");
    }

    const eventId = requiredString(payload, "eventId", 36);

    if (!uuidPattern.test(eventId)) {
      throw new ApiError(400, "invalid_engagement_event", "eventId must be a UUID.");
    }

    const eventTypeValue = requiredString(payload, "eventType", 64);

    if (!allowedEventTypes.has(eventTypeValue as EngagementEventType)) {
      throw new ApiError(400, "invalid_engagement_event", "eventType is not supported.");
    }

    const eventType = eventTypeValue as EngagementEventType;
    const publicListing = optionalPublicListingId(payload, "listingId");

    if (listingEventTypes.has(eventType) && !publicListing) {
      throw new ApiError(
        400,
        "invalid_engagement_event",
        "listingId is required for listing engagement.",
      );
    }

    const occurredAtValue = requiredString(payload, "occurredAt", 40);
    const occurredAt = new Date(occurredAtValue);
    const currentTime = this.now();

    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.getTime() < currentTime.getTime() - this.config.maxEventAgeMs ||
      occurredAt.getTime() > currentTime.getTime() + this.config.futureToleranceMs
    ) {
      throw new ApiError(
        400,
        "invalid_engagement_timestamp",
        "occurredAt is outside the accepted event window.",
      );
    }

    const viewportDurationMs =
      typeof payload.viewportDurationMs === "number" &&
      Number.isSafeInteger(payload.viewportDurationMs)
        ? payload.viewportDurationMs
        : undefined;

    if (
      eventType === "listing_view" &&
      (viewportDurationMs === undefined || viewportDurationMs < 1_000)
    ) {
      throw new ApiError(
        400,
        "insufficient_view_duration",
        "A listing view requires at least 1000ms in the viewport.",
      );
    }

    const rankedPosition =
      typeof payload.rankedPosition === "number" && Number.isSafeInteger(payload.rankedPosition)
        ? payload.rankedPosition
        : undefined;

    if (rankedPosition !== undefined && (rankedPosition < 0 || rankedPosition > 10_000)) {
      throw new ApiError(
        400,
        "invalid_engagement_event",
        "rankedPosition is outside the accepted range.",
      );
    }

    const privacySessionId = actor.privacySessionId.trim();

    if (privacySessionId.length < 16 || privacySessionId.length > 256) {
      throw new ApiError(
        400,
        "invalid_privacy_session",
        "A valid privacy session identifier is required.",
      );
    }

    const searchQuery =
      typeof payload.searchQuery === "string" ? payload.searchQuery.trim() : undefined;

    if (searchQuery && searchQuery.length > 500) {
      throw new ApiError(
        400,
        "invalid_engagement_event",
        "searchQuery must be at most 500 characters.",
      );
    }

    const properties = sanitizeProperties(payload.properties);
    const listingId = publicListing
      ? await this.dataPlane.listings.resolveInternalId(
          publicListing.providerId,
          publicListing.sourceListingId,
        )
      : undefined;

    if (publicListing && !listingId) {
      throw new ApiError(
        404,
        "listing_not_persisted",
        `Listing ${publicListing.publicId} is not available for durable engagement.`,
      );
    }

    const event: EngagementEventInput = {
      eventId: eventId.toLowerCase(),
      eventType,
      listingId,
      occurredAt,
      privacySessionHash: hashValue(
        this.config.sessionPepper,
        "privacy-session-v1",
        privacySessionId,
      ),
      properties,
      rankedPosition,
      requestId: optionalUuid(payload, "requestId"),
      searchQueryHash: searchQuery
        ? hashValue(
            this.config.sessionPepper,
            "search-query-v1",
            searchQuery.toLowerCase().replace(/\s+/g, " "),
          )
        : undefined,
      userId: actor.userId?.toLowerCase(),
      viewportDurationMs,
    };
    const result = await this.dataPlane.engagement.record(event);

    return {
      accepted: result.recorded || result.duplicate,
      duplicate: result.duplicate,
      eventId: event.eventId,
    };
  }
}
