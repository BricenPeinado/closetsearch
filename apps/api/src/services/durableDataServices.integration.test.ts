import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../api-error.js";
import type { ListingObservationInput } from "../db/postgres/model.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { AlertInboxService } from "./alertInboxService.js";
import { DurableEngagementService } from "./durableEngagementService.js";
import { PersistedEntitlementService, premiumAnalyticsFeature } from "./entitlementService.js";

const now = new Date("2026-07-24T12:00:00.000Z");

async function insertUser(
  database: Awaited<ReturnType<typeof createPostgresTestHarness>>["database"],
  userId = randomUUID(),
) {
  await database.query(
    `INSERT INTO users (
       id,
       username,
       normalized_username,
       password_hash
     ) VALUES ($1, $2, $2, 'scrypt$test')`,
    [userId, `user-${userId.slice(0, 8)}`],
  );
  return userId;
}

function listing(idempotencyKey: string): ListingObservationInput {
  return {
    analyticsEligible: true,
    availability: "available",
    category: "jackets",
    condition: "good",
    fetchedAt: now,
    id: randomUUID(),
    idempotencyKey,
    images: [],
    listingType: "buy_now",
    marketStatus: "active",
    observedAt: now,
    originalPrice: {
      amountMinor: 15_000n,
      currency: "USD",
    },
    providerBrand: "Kapital",
    providerId: "fixture-provider",
    sourceListingId: "listing-service-test",
    sourceMarketplace: "Fixture Market",
    sourceUrl: "https://market.example/listing-service-test",
    title: "Kapital jacket",
  };
}

describe("durable PostgreSQL domain services", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createPostgresTestHarness>>> = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  it("validates, hashes, and deduplicates client-originated viewport events", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const userId = await insertUser(harness.database);
    const persisted = await harness.dataPlane.listings.upsertObservation(
      listing("service-engagement-listing"),
    );
    const service = new DurableEngagementService(
      harness.dataPlane,
      {
        futureToleranceMs: 300_000,
        maxEventAgeMs: 604_800_000,
        sessionPepper: "e".repeat(32),
      },
      () => now,
    );
    const eventId = randomUUID();
    const actor = {
      privacySessionId: "anonymous-session-123456789",
      userId,
    };
    const payload = {
      eventId,
      eventType: "listing_view",
      listingId: "fixture-provider:listing-service-test",
      occurredAt: now.toISOString(),
      viewportDurationMs: 1_250,
    };

    await expect(service.recordClientEvent(actor, payload)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      eventId,
    });
    await expect(service.recordClientEvent(actor, payload)).resolves.toEqual({
      accepted: true,
      duplicate: true,
      eventId,
    });

    const stored = await harness.database.query<{
      listing_id: string;
      privacy_session_hash: string;
      user_id: string;
    }>(
      `SELECT listing_id, privacy_session_hash, user_id
       FROM engagement_events
       WHERE event_id = $1`,
      [eventId],
    );
    expect(stored.rows[0]).toMatchObject({
      listing_id: persisted.listingId,
      user_id: userId,
    });
    expect(stored.rows[0].privacy_session_hash).toHaveLength(64);
    expect(stored.rows[0].privacy_session_hash).not.toContain(actor.privacySessionId);

    await expect(
      service.recordClientEvent(actor, {
        ...payload,
        eventId: randomUUID(),
        viewportDurationMs: 999,
      }),
    ).rejects.toMatchObject({
      code: "insufficient_view_duration",
    });
    await expect(
      service.recordClientEvent(actor, {
        ...payload,
        eventId: randomUUID(),
        userId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "spoofed_user_id",
    });
    await expect(
      service.recordClientEvent(actor, {
        ...payload,
        eventId: randomUUID(),
        listingId: persisted.listingId,
      }),
    ).rejects.toMatchObject({
      code: "invalid_engagement_event",
    });
    await expect(
      service.recordClientEvent(actor, {
        ...payload,
        eventId: randomUUID(),
        listingId: "fixture-provider:not-persisted",
      }),
    ).rejects.toMatchObject({
      code: "listing_not_persisted",
      statusCode: 404,
    });
    await expect(
      service.recordClientEvent(actor, {
        ...payload,
        eventId: randomUUID(),
        properties: {
          marketplace: {
            metadata: {
              authorizationToken: "must-not-be-stored",
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "sensitive_engagement_data",
      statusCode: 400,
    });
  });

  it("uses persisted entitlements and makes development grants unmistakable", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const adminUserId = await insertUser(harness.database);
    const targetUserId = await insertUser(harness.database);
    const service = new PersistedEntitlementService(
      harness.dataPlane,
      {
        ENTITLEMENT_ADMIN_DEVELOPMENT_ENABLED: "true",
        NODE_ENV: "development",
      },
      () => now,
    );
    const entitlement = await service.grantDevelopmentEntitlement(
      {
        isAdmin: true,
        userId: adminUserId,
      },
      {
        targetUserId,
      },
    );

    expect(entitlement).toMatchObject({
      featureKey: premiumAnalyticsFeature,
      metadata: expect.objectContaining({
        developmentOnly: true,
      }),
      provider: "admin",
      userId: targetUserId,
    });
    await expect(service.hasFeature(targetUserId, premiumAnalyticsFeature)).resolves.toBe(true);
    await expect(service.getPremiumAccess(targetUserId)).resolves.toMatchObject({
      isPremium: true,
      planName: "Development entitlement — no billing",
    });

    const productionService = new PersistedEntitlementService(
      harness.dataPlane,
      {
        ENTITLEMENT_ADMIN_DEVELOPMENT_ENABLED: "true",
        NODE_ENV: "production",
      },
      () => now,
    );
    await expect(productionService.getPremiumAccess(targetUserId)).resolves.toMatchObject({
      isPremium: false,
      planName: "Free",
    });
    await expect(productionService.hasFeature(targetUserId, premiumAnalyticsFeature)).resolves.toBe(
      false,
    );
    await expect(
      productionService.grantDevelopmentEntitlement(
        {
          isAdmin: true,
          userId: adminUserId,
        },
        {
          targetUserId,
        },
      ),
    ).rejects.toMatchObject({
      code: "development_entitlements_forbidden",
    });
  });

  it("keeps alert inbox mutations scoped to the authenticated user", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const userId = await insertUser(harness.database);
    const otherUserId = await insertUser(harness.database);
    const watchlistId = randomUUID();
    await harness.database.query(
      `INSERT INTO watchlists (
         id,
         user_id,
         label,
         source_marketplace,
         enabled
       ) VALUES ($1, $2, 'Fixture alerts', 'Fixture Market', TRUE)`,
      [watchlistId, userId],
    );
    const persisted = await harness.dataPlane.listings.upsertObservation(
      listing("service-alert-listing"),
    );
    expect(await harness.dataPlane.alerts.matchListing(persisted.listingId, now, true)).toBe(1);
    const service = new AlertInboxService(harness.dataPlane, () => now);
    const initial = await service.list(userId);
    expect(initial.unseenCount).toBe(1);
    const alertMatchId = initial.alerts[0].id;

    await expect(service.markSeen(userId, { alertMatchId })).resolves.toEqual({
      alertMatchId,
      state: "seen",
    });
    await expect(
      service.dismiss(userId, {
        alertMatchId,
        userId: otherUserId,
      }),
    ).rejects.toMatchObject({
      code: "spoofed_user_id",
    });
    await expect(service.dismiss(otherUserId, { alertMatchId })).rejects.toBeInstanceOf(ApiError);
    await expect(service.dismiss(userId, { alertMatchId })).resolves.toEqual({
      alertMatchId,
      state: "dismissed",
    });
    await expect(service.list(userId)).resolves.toMatchObject({
      unseenCount: 0,
      alerts: [
        expect.objectContaining({
          id: alertMatchId,
          state: "dismissed",
        }),
      ],
    });
  });
});
