import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngagementViewDeduplicator,
  getPrivacySessionId,
  recordEngagementEvent,
} from "./engagement-client";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const eventId = "da631f10-b1fd-4a0f-b0be-629b30c3917f";
const privacySessionId = "58972ef8-58f7-452d-acb4-80317b56ad7c";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engagement client", () => {
  it("keeps an opaque privacy identifier stable in session storage", () => {
    const storage = new MemoryStorage();
    const createId = vi.fn().mockReturnValue(privacySessionId);

    expect(getPrivacySessionId(storage, createId)).toBe(privacySessionId);
    expect(getPrivacySessionId(storage, createId)).toBe(privacySessionId);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("sends bounded keepalive events without a client-supplied user identity", async () => {
    const storage = new MemoryStorage();
    storage.setItem("closetsearch.privacy-session.v1", privacySessionId);
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await expect(
      recordEngagementEvent(
        {
          eventType: "listing_view",
          listingId: "ebay:listing-123",
          properties: {
            providerId: "ebay",
            surface: "search_results",
          },
          viewportDurationMs: 1_000,
        },
        {
          createId: () => eventId,
          fetch: request,
          isOnline: () => true,
          now: () => new Date("2026-07-24T12:00:00.000Z"),
          storage,
        },
      ),
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(url).toBe("http://localhost:4000/events");
    expect(init).toMatchObject({
      credentials: "include",
      keepalive: true,
      method: "POST",
    });
    expect(init.headers).toMatchObject({
      "X-Privacy-Session-ID": privacySessionId,
    });
    expect(body).toMatchObject({
      eventId,
      eventType: "listing_view",
      listingId: "ebay:listing-123",
      occurredAt: "2026-07-24T12:00:00.000Z",
      viewportDurationMs: 1_000,
    });
    expect(body).not.toHaveProperty("privacySessionId");
    expect(body).not.toHaveProperty("userId");
  });

  it("drops offline and oversized events without interrupting the UI", async () => {
    const request = vi.fn();

    await expect(
      recordEngagementEvent(
        {
          eventType: "search_submit",
          properties: {
            value: "x".repeat(5_000),
          },
        },
        {
          createId: () => eventId,
          fetch: request,
          isOnline: () => true,
        },
      ),
    ).resolves.toBe(false);

    await expect(
      recordEngagementEvent(
        {
          eventType: "search_submit",
        },
        {
          createId: () => eventId,
          fetch: request,
          isOnline: () => false,
        },
      ),
    ).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
  });

  it("deduplicates a listing view within a page context", () => {
    const deduplicator = new EngagementViewDeduplicator();

    expect(deduplicator.claim("search:q=kapital", "ebay:1")).toBe(true);
    expect(deduplicator.claim("search:q=kapital", "ebay:1")).toBe(false);
    expect(deduplicator.claim("search:q=kapital", "ebay:2")).toBe(true);
    expect(deduplicator.claim("search:q=rick", "ebay:1")).toBe(true);
  });
});
