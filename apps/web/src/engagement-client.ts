import type { Listing } from "@closetsearch/shared";
import { apiBaseUrl } from "./api-client";

const privacySessionStorageKey = "closetsearch.privacy-session.v1";
const maximumPropertyBytes = 4_096;
const maximumPayloadBytes = 8_192;

export type EngagementEventType =
  | "conversion"
  | "filter_apply"
  | "hide"
  | "like"
  | "listing_open"
  | "listing_view"
  | "recommendation_impression"
  | "recommendation_request"
  | "saved_filter"
  | "saved_search"
  | "search_submit"
  | "unlike"
  | "watchlist_create";

export type EngagementPropertyValue =
  | boolean
  | number
  | string
  | null
  | EngagementPropertyValue[]
  | { [key: string]: EngagementPropertyValue };

export interface EngagementEventDraft {
  eventType: EngagementEventType;
  listingId?: string;
  properties?: Record<string, EngagementPropertyValue>;
  rankedPosition?: number;
  requestId?: string;
  searchQuery?: string;
  viewportDurationMs?: number;
}

interface EngagementEventPayload extends EngagementEventDraft {
  eventId: string;
  occurredAt: string;
}

interface PrivacySessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface EngagementClientDependencies {
  createId?: () => string;
  fetch?: typeof fetch;
  isOnline?: () => boolean;
  now?: () => Date;
  storage?: PrivacySessionStorage;
}

let memoryPrivacySessionId: string | undefined;

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function getDefaultStorage(): PrivacySessionStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isValidPrivacySessionId(value: string | null | undefined) {
  return Boolean(
    value && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value),
  );
}

export function createEngagementId(
  cryptoProvider: Pick<Crypto, "getRandomValues" | "randomUUID"> = crypto,
) {
  if (typeof cryptoProvider.randomUUID === "function") {
    return cryptoProvider.randomUUID();
  }

  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hexadecimal = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join("-");
}

export function getPrivacySessionId(storage = getDefaultStorage(), createId = createEngagementId) {
  try {
    const storedIdentifier = storage?.getItem(privacySessionStorageKey);

    if (isValidPrivacySessionId(storedIdentifier)) {
      memoryPrivacySessionId = storedIdentifier ?? undefined;
      return storedIdentifier as string;
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }

  if (isValidPrivacySessionId(memoryPrivacySessionId)) {
    return memoryPrivacySessionId as string;
  }

  const identifier = createId();

  if (!isValidPrivacySessionId(identifier)) {
    throw new Error("Could not create a valid privacy session identifier.");
  }

  memoryPrivacySessionId = identifier;

  try {
    storage?.setItem(privacySessionStorageKey, identifier);
  } catch {
    // The in-memory identifier remains stable for this document lifecycle.
  }

  return identifier;
}

function isEventPayloadBounded(payload: EngagementEventPayload) {
  if (
    payload.properties &&
    (Object.keys(payload.properties).length > 20 ||
      byteLength(JSON.stringify(payload.properties)) > maximumPropertyBytes)
  ) {
    return false;
  }

  if (payload.searchQuery !== undefined && payload.searchQuery.trim().length > 500) {
    return false;
  }

  return byteLength(JSON.stringify(payload)) <= maximumPayloadBytes;
}

function defaultIsOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Records telemetry without affecting the product action that produced it.
 * Keepalive fetch is intentional: sendBeacon cannot attach the privacy-session
 * header required by the API.
 */
export async function recordEngagementEvent(
  draft: EngagementEventDraft,
  dependencies: EngagementClientDependencies = {},
) {
  const request = dependencies.fetch ?? globalThis.fetch;

  if (typeof request !== "function" || !(dependencies.isOnline ?? defaultIsOnline)()) {
    return false;
  }

  try {
    const payload: EngagementEventPayload = {
      ...draft,
      eventId: (dependencies.createId ?? createEngagementId)(),
      occurredAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    };

    if (!isEventPayloadBounded(payload)) {
      return false;
    }

    const response = await request(`${apiBaseUrl}/events`, {
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "X-Privacy-Session-ID": getPrivacySessionId(
          dependencies.storage,
          dependencies.createId ?? createEngagementId,
        ),
      },
      keepalive: true,
      method: "POST",
    });

    return response.ok;
  } catch {
    return false;
  }
}

export function isListingEngagementEligible(listing: Listing) {
  return (
    listing.analyticsEligibility?.eligible !== false &&
    listing.source.isMock !== true &&
    listing.source.dataOrigin !== "mock"
  );
}

export class EngagementViewDeduplicator {
  private readonly keys = new Set<string>();

  constructor(private readonly maximumEntries = 2_000) {}

  claim(contextId: string, listingId: string) {
    const key = `${contextId}:${listingId}`;

    if (this.keys.has(key)) {
      return false;
    }

    if (this.keys.size >= this.maximumEntries) {
      const oldestKey = this.keys.values().next().value as string | undefined;

      if (oldestKey) {
        this.keys.delete(oldestKey);
      }
    }

    this.keys.add(key);
    return true;
  }
}

export const sessionViewDeduplicator = new EngagementViewDeduplicator();
