import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ListingObservationInput } from "../db/postgres/model.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { AlertDeliveryProcessor } from "./alertDeliveryService.js";
import { CaptureEmailTransport, CaptureSmsTransport } from "./notificationTransports.js";

const now = new Date("2030-07-26T12:00:00.000Z");
type TestHarness = Awaited<ReturnType<typeof createPostgresTestHarness>>;

function listing(override: Partial<ListingObservationInput> = {}): ListingObservationInput {
  return {
    analyticsEligible: true,
    availability: "available",
    category: "jackets",
    condition: "good",
    fetchedAt: now,
    id: randomUUID(),
    idempotencyKey: "delivery-listing-1",
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
    sourceListingId: "delivery-listing",
    sourceMarketplace: "Fixture Market",
    sourceUrl: "https://market.example/delivery-listing",
    title: "Kapital jacket",
    ...override,
  };
}

async function seedRecipient(
  harness: TestHarness,
  input: {
    email?: boolean;
    eventTypes?: string[];
    maxPriceMinor?: bigint;
    sms?: boolean;
  } = {},
) {
  const userId = randomUUID();
  const watchlistId = randomUUID();
  const email = `user-${userId.slice(0, 8)}@example.com`;
  const phone = "+12025550123";
  await harness.database.query(
    `INSERT INTO users (
       id, username, normalized_username, password_hash, created_at
     ) VALUES ($1, $2, $2, 'scrypt$test', $3)`,
    [userId, `user-${userId.slice(0, 8)}`, now],
  );

  if (input.email) {
    await harness.database.query(
      `INSERT INTO user_identities (
         id, user_id, identity_type, provider, provider_subject,
         normalized_email, verified_at, created_at
       ) VALUES ($1, $2, 'email', 'password', $3, $3, $4, $4)`,
      [randomUUID(), userId, email, now],
    );
    await harness.dataPlane.notifications.recordConsent({
      action: "opt_in",
      channel: "email",
      destination: email,
      occurredAt: now,
      source: "test",
      userId,
    });
  }

  if (input.sms) {
    const identity = await harness.dataPlane.notifications.upsertPhoneIdentity(userId, phone, now);
    await harness.database.query(
      `UPDATE user_phone_identities
       SET verified_at = $2
       WHERE id = $1`,
      [identity.id, now],
    );
    await harness.dataPlane.notifications.recordConsent({
      action: "opt_in",
      channel: "sms",
      destination: phone,
      occurredAt: now,
      source: "test",
      userId,
    });
  }

  await harness.dataPlane.notifications.updateSettings({
    emailEnabled: input.email,
    smsEnabled: input.sms,
    userId,
  });
  await harness.database.query(
    `INSERT INTO watchlists (
       id,
       user_id,
       label,
       source_marketplace,
       enabled,
       alert_event_types,
       alert_email_enabled,
       alert_sms_enabled,
       max_price_minor,
       price_currency
     ) VALUES (
       $1, $2, 'Fixture alerts', 'Fixture Market', TRUE, $3::jsonb,
       $4, $5, $6, $7
     )`,
    [
      watchlistId,
      userId,
      JSON.stringify(
        input.eventTypes ?? ["new_listing", "price_drop", "auction_ending", "back_in_range"],
      ),
      input.email ?? false,
      input.sms ?? false,
      input.maxPriceMinor?.toString() ?? null,
      input.maxPriceMinor === undefined ? null : "USD",
    ],
  );
  return { email, phone, userId, watchlistId };
}

describe("AlertDeliveryProcessor", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createPostgresTestHarness>>> = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  it("delivers a consented email exactly once and persists only transport-safe metadata", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const userId = randomUUID();
    const watchlistId = randomUUID();
    await harness.database.query(
      `INSERT INTO users (
         id,
         username,
         normalized_username,
         password_hash,
         created_at
       ) VALUES ($1, $2, $2, 'scrypt$test', $3)`,
      [userId, `user-${userId.slice(0, 8)}`, now],
    );
    await harness.database.query(
      `INSERT INTO user_identities (
         id,
         user_id,
         identity_type,
         provider,
         provider_subject,
         normalized_email,
         verified_at,
         created_at
       ) VALUES ($1, $2, 'email', 'password', $3, $3, $4, $4)`,
      [randomUUID(), userId, "user@example.com", now],
    );
    await harness.dataPlane.notifications.updateSettings({
      emailEnabled: true,
      userId,
    });
    await harness.dataPlane.notifications.recordConsent({
      action: "opt_in",
      channel: "email",
      destination: "user@example.com",
      occurredAt: now,
      source: "test",
      userId,
    });
    await harness.database.query(
      `INSERT INTO watchlists (
         id,
         user_id,
         label,
         source_marketplace,
         enabled,
         alert_email_enabled
       ) VALUES ($1, $2, 'Fixture alerts', 'Fixture Market', TRUE, TRUE)`,
      [watchlistId, userId],
    );
    const persisted = await harness.dataPlane.listings.upsertObservation(listing());
    await expect(
      harness.dataPlane.alerts.matchListing(persisted.listingId, now, true),
    ).resolves.toBe(1);
    const email = new CaptureEmailTransport();
    const processor = new AlertDeliveryProcessor(harness.dataPlane, {
      deliveryEnabled: true,
      emailTransport: email,
      env: {
        ALERT_PUBLIC_BASE_URL: "http://localhost:5173",
        AUTH_SESSION_PEPPER: "p".repeat(32),
        NODE_ENV: "test",
      },
      now: () => now,
      providerEligible: () => true,
      smsTransport: new CaptureSmsTransport(),
    });

    const firstRun = await processor.processDue();
    const firstRunRows = await harness.database.query<{
      last_error_code: string | null;
      last_error_message: string | null;
      status: string;
    }>(
      `SELECT status, last_error_code, last_error_message
       FROM alert_deliveries
       WHERE channel = 'email'`,
    );
    expect(email.messages).toHaveLength(1);
    expect(firstRunRows.rows[0]?.last_error_message).toBeNull();
    expect({ firstRun, rows: firstRunRows.rows }).toMatchObject({
      firstRun: {
        delivered: 1,
        failed: 0,
        processed: 1,
        suppressed: 0,
      },
      rows: [{ status: "delivered" }],
    });
    await expect(processor.processDue()).resolves.toMatchObject({
      delivered: 0,
      processed: 0,
    });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({
      idempotencyKey:
        `email:${watchlistId}:${persisted.listingId}:new_listing:` +
        `listing:${persisted.listingId}`,
      to: "user@example.com",
    });
    expect(email.messages[0]?.headers).toMatchObject({
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const closetSearchUrl =
      `http://localhost:5173/listings/` + `fixture-provider%3Adelivery-listing`;
    expect(email.messages[0]?.text).toContain(closetSearchUrl);
    expect(email.messages[0]?.html).toContain(closetSearchUrl);
    expect(email.messages[0]?.text).not.toContain("https://market.example/delivery-listing");

    const deliveries = await harness.database.query<{
      destination_hash: string;
      provider_response: unknown;
      status: string;
    }>(
      `SELECT status, destination_hash, provider_response
       FROM alert_deliveries
       WHERE channel = 'email'`,
    );
    expect(deliveries.rows).toEqual([
      expect.objectContaining({
        destination_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        status: "delivered",
      }),
    ]);
    expect(JSON.stringify(deliveries.rows)).not.toContain("user@example.com");
    await expect(harness.dataPlane.alerts.listDeliveryStatusCounts()).resolves.toEqual(
      expect.arrayContaining([
        {
          channel: "email",
          count: 1,
          status: "delivered",
        },
      ]),
    );
  });

  it("suppresses a queued alert when provider authorization is revoked before claim", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    await seedRecipient(harness, { email: true });
    const persisted = await harness.dataPlane.listings.upsertObservation(
      listing({ providerId: "grailed" }),
    );
    await expect(
      harness.dataPlane.alerts.matchListing(persisted.listingId, now, false),
    ).resolves.toBe(0);
    await expect(
      harness.database.query(`SELECT id FROM alert_deliveries WHERE channel = 'in_app'`),
    ).resolves.toMatchObject({ rows: [] });
    await harness.dataPlane.alerts.matchListing(persisted.listingId, now, true);
    const email = new CaptureEmailTransport();
    const processor = new AlertDeliveryProcessor(harness.dataPlane, {
      deliveryEnabled: true,
      emailTransport: email,
      env: {
        ALERT_PUBLIC_BASE_URL: "http://localhost:5173",
        AUTH_SESSION_PEPPER: "p".repeat(32),
        NODE_ENV: "test",
      },
      now: () => now,
      providerEligible: () => false,
      smsTransport: new CaptureSmsTransport(),
    });

    await expect(processor.processDue()).resolves.toMatchObject({
      delivered: 0,
      suppressed: 1,
    });
    expect(email.messages).toHaveLength(0);
  });

  it("deduplicates auction-ending polls by end time", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    await seedRecipient(harness, { eventTypes: ["auction_ending"] });
    const auctionEndsAt = new Date(now.getTime() + 6 * 60 * 60_000);
    const first = await harness.dataPlane.listings.upsertObservation(
      listing({
        auctionCurrentBid: { amountMinor: 15_000n, currency: "USD" },
        auctionEndsAt,
        idempotencyKey: "auction-poll-1",
        listingType: "auction",
        observationKind: "current_bid",
      }),
    );
    await harness.dataPlane.alerts.matchListing(first.listingId, now, true);
    await harness.dataPlane.listings.upsertObservation(
      listing({
        auctionCurrentBid: { amountMinor: 15_500n, currency: "USD" },
        auctionEndsAt,
        idempotencyKey: "auction-poll-2",
        listingType: "auction",
        observationKind: "current_bid",
        observedAt: new Date(now.getTime() + 60_000),
        originalPrice: { amountMinor: 15_500n, currency: "USD" },
      }),
    );
    await harness.dataPlane.alerts.matchListing(
      first.listingId,
      new Date(now.getTime() + 60_000),
      true,
    );

    const deliveries = await harness.database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM alert_deliveries
       WHERE event_type = 'auction_ending'
         AND channel = 'in_app'`,
    );
    expect(deliveries.rows[0]?.count).toBe("1");
  });

  it("creates one delivery per price-drop trigger and revives a dismissed inbox match", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    const { userId } = await seedRecipient(harness, {
      eventTypes: ["price_drop"],
    });
    const first = await harness.dataPlane.listings.upsertObservation(
      listing({
        idempotencyKey: "price-trigger-1",
        originalPrice: { amountMinor: 20_000n, currency: "USD" },
      }),
    );
    await harness.dataPlane.alerts.matchListing(first.listingId, now, true);
    await harness.dataPlane.listings.upsertObservation(
      listing({
        idempotencyKey: "price-trigger-2",
        observedAt: new Date(now.getTime() + 60_000),
        originalPrice: { amountMinor: 18_000n, currency: "USD" },
      }),
    );
    const secondAt = new Date(now.getTime() + 60_000);
    await harness.dataPlane.alerts.matchListing(first.listingId, secondAt, true);
    const [match] = await harness.dataPlane.alerts.listInbox(userId);
    await harness.dataPlane.alerts.dismiss(userId, match.id, new Date(secondAt.getTime() + 1_000));
    await harness.dataPlane.alerts.matchListing(first.listingId, secondAt, true);
    expect((await harness.dataPlane.alerts.listInbox(userId))[0]?.state).toBe("dismissed");

    await harness.dataPlane.listings.upsertObservation(
      listing({
        idempotencyKey: "price-trigger-3",
        observedAt: new Date(now.getTime() + 120_000),
        originalPrice: { amountMinor: 16_000n, currency: "USD" },
      }),
    );
    await harness.dataPlane.alerts.matchListing(
      first.listingId,
      new Date(now.getTime() + 120_000),
      true,
    );
    const deliveries = await harness.database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM alert_deliveries
       WHERE event_type = 'price_drop'
         AND channel = 'in_app'`,
    );

    expect(deliveries.rows[0]?.count).toBe("2");
    expect((await harness.dataPlane.alerts.listInbox(userId))[0]).toMatchObject({
      dismissedAt: undefined,
      seenAt: undefined,
      state: "unseen",
    });
  });

  it("generates back-in-range only when a prior price was outside the bound", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    await seedRecipient(harness, {
      eventTypes: ["back_in_range"],
      maxPriceMinor: 15_000n,
    });
    const first = await harness.dataPlane.listings.upsertObservation(
      listing({
        idempotencyKey: "range-trigger-1",
        originalPrice: { amountMinor: 20_000n, currency: "USD" },
      }),
    );
    await expect(harness.dataPlane.alerts.matchListing(first.listingId, now, true)).resolves.toBe(
      0,
    );
    await harness.dataPlane.listings.upsertObservation(
      listing({
        idempotencyKey: "range-trigger-2",
        observedAt: new Date(now.getTime() + 60_000),
        originalPrice: { amountMinor: 14_000n, currency: "USD" },
      }),
    );
    await expect(
      harness.dataPlane.alerts.matchListing(
        first.listingId,
        new Date(now.getTime() + 60_000),
        true,
      ),
    ).resolves.toBe(1);
  });

  it("uses the ClosetSearch listing link in bounded SMS and ignores regressive callbacks", async () => {
    const harness = await createPostgresTestHarness();
    harnesses.push(harness);
    await seedRecipient(harness, { sms: true });
    const persisted = await harness.dataPlane.listings.upsertObservation(listing());
    await harness.dataPlane.alerts.matchListing(persisted.listingId, now, true);
    const sms = new CaptureSmsTransport();
    const processor = new AlertDeliveryProcessor(harness.dataPlane, {
      deliveryEnabled: true,
      emailTransport: new CaptureEmailTransport(),
      env: {
        ALERT_PUBLIC_BASE_URL: "http://localhost:5173",
        AUTH_SESSION_PEPPER: "p".repeat(32),
        NODE_ENV: "test",
      },
      now: () => now,
      providerEligible: () => true,
      smsTransport: sms,
    });
    await processor.processDue();
    expect(sms.messages[0]?.text).toContain(
      "http://localhost:5173/listings/fixture-provider%3Adelivery-listing",
    );
    expect(sms.messages[0]?.text).not.toContain("https://market.example/delivery-listing");
    const row = await harness.database.query<{
      id: string;
      provider_message_id: string;
    }>(
      `SELECT id, provider_message_id
       FROM alert_deliveries
       WHERE channel = 'sms'`,
    );
    const delivery = row.rows[0];
    await harness.database.query(
      `UPDATE alert_deliveries
       SET status = 'dead_letter',
           provider_status_rank = 0,
           provider_delivery_status = NULL
       WHERE id = $1`,
      [delivery.id],
    );
    await harness.dataPlane.alerts.reconcileSmsDeliveryCallback({
      deliveryId: delivery.id,
      messageStatus: "delivered",
      occurredAt: new Date(now.getTime() + 10_000),
      providerMessageId: delivery.provider_message_id,
    });
    await harness.dataPlane.alerts.reconcileSmsDeliveryCallback({
      deliveryId: delivery.id,
      errorCode: "30003",
      messageStatus: "failed",
      occurredAt: new Date(now.getTime() + 20_000),
      providerMessageId: delivery.provider_message_id,
    });
    const final = await harness.database.query<{
      provider_delivery_status: string;
      provider_status_rank: number;
      status: string;
    }>(
      `SELECT status, provider_delivery_status, provider_status_rank
       FROM alert_deliveries
       WHERE id = $1`,
      [delivery.id],
    );
    expect(final.rows[0]).toMatchObject({
      provider_delivery_status: "delivered",
      provider_status_rank: 60,
      status: "delivered",
    });
  });
});
