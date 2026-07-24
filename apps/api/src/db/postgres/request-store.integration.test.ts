import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ListingObservationInput } from "./model.js";
import { PostgresRequestStore } from "./request-store.js";
import { RequestStoreError } from "./request-store-types.js";
import { createPostgresTestHarness } from "./test-harness.js";

const now = new Date("2026-07-24T12:00:00.000Z");
const passwordHash = `scrypt$${"p".repeat(64)}`;

function hash(label: string) {
  return createHash("sha256").update(label).digest("hex");
}

function listing(
  idempotencyKey: string,
  sourceListingId = "request-store-listing",
): ListingObservationInput {
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
    sourceListingId,
    sourceMarketplace: "Fixture Market",
    sourceUrl: `https://market.example/${sourceListingId}`,
    title: "Kapital jacket",
  };
}

describe("PostgresRequestStore", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createPostgresTestHarness>>> = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.database.close()));
  });

  async function harness() {
    const created = await createPostgresTestHarness();
    harnesses.push(created);
    return created;
  }

  async function createUser(
    store: PostgresRequestStore,
    username = `user-${randomUUID().slice(0, 8)}`,
  ) {
    return store.createUser({
      createdAt: now,
      onboardingPreferences: {
        categories: ["jackets"],
        favoriteBrands: ["Kapital"],
        priceRange: "100-300",
      },
      passwordHash,
      preferredCurrency: "usd",
      username,
    });
  }

  it("creates users and settings atomically and enforces normalized signup uniqueness", async () => {
    const test = await harness();
    const store = test.dataPlane.requestStore;
    const user = await createUser(store, "  ClosetFan  ");

    expect(user).toMatchObject({
      currencyPreference: "USD",
      onboardingPreferences: {
        categories: ["jackets"],
        favoriteBrands: ["Kapital"],
      },
      username: "ClosetFan",
    });
    await expect(store.findUserCredentialsByNormalizedUsername("closetfan")).resolves.toMatchObject(
      {
        id: user.id,
        passwordHash,
      },
    );
    await expect(createUser(store, "CLOSETFAN")).rejects.toMatchObject({
      code: "username_taken",
    });

    const rows = await test.database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM user_settings
       WHERE user_id = $1`,
      [user.id],
    );
    expect(rows.rows[0].count).toBe("1");
  });

  it("persists verified identities and one-time account-token lifecycle without raw tokens", async () => {
    const test = await harness();
    const store = test.dataPlane.requestStore;
    const first = await createUser(store, "identity-one");
    const second = await createUser(store, "identity-two");
    const identity = await store.upsertEmailIdentity({
      createdAt: now,
      email: "Owner@Example.com",
      userId: first.id,
    });

    expect(identity).toMatchObject({
      email: "Owner@Example.com",
      normalizedEmail: "owner@example.com",
      userId: first.id,
    });
    await expect(
      store.upsertEmailIdentity({
        email: "owner@example.com",
        userId: second.id,
      }),
    ).rejects.toMatchObject({
      code: "email_in_use",
    });

    const verified = await store.markEmailIdentityVerified(
      identity.id,
      first.id,
      new Date(now.getTime() + 1_000),
    );
    expect(verified?.verifiedAt).toBe(new Date(now.getTime() + 1_000).toISOString());

    const firstTokenHash = hash("first-account-token");
    const secondTokenHash = hash("second-account-token");
    await store.issueAccountToken({
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      emailIdentityId: identity.id,
      purpose: "email_verification",
      tokenHash: firstTokenHash,
      userId: first.id,
    });
    const secondToken = await store.issueAccountToken({
      createdAt: new Date(now.getTime() + 2_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      emailIdentityId: identity.id,
      purpose: "email_verification",
      tokenHash: secondTokenHash,
      userId: first.id,
    });

    await expect(
      store.findActiveAccountToken(
        firstTokenHash,
        "email_verification",
        new Date(now.getTime() + 3_000),
      ),
    ).resolves.toBeUndefined();
    expect(secondToken).not.toHaveProperty("tokenHash");
    await expect(
      store.consumeActiveAccountToken(
        secondTokenHash,
        "email_verification",
        new Date(now.getTime() + 3_000),
      ),
    ).resolves.toMatchObject({
      id: secondToken.id,
    });
    await expect(
      store.consumeActiveAccountToken(
        secondTokenHash,
        "email_verification",
        new Date(now.getTime() + 4_000),
      ),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(secondToken)).not.toContain(secondTokenHash);
  });

  it("resolves only live sessions, records a hashed IP hint, and preserves first revocation", async () => {
    const test = await harness();
    const store = new PostgresRequestStore(test.database, {
      ipHintPepper: "i".repeat(32),
      nodeEnv: "production",
    });
    const user = await createUser(store, "session-user");
    const activeHash = hash("active-session");
    const rawIp = "203.0.113.42";
    const active = await store.createAuthSession({
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ipHint: rawIp,
      sessionTokenHash: activeHash,
      userAgent: "RequestStore Test",
      userId: user.id,
    });

    expect(active).toMatchObject({
      ipHintRecorded: true,
      userId: user.id,
    });
    expect(active).not.toHaveProperty("sessionTokenHash");
    await expect(
      store.resolveAuthSessionByTokenHash(activeHash, new Date(now.getTime() + 59_999)),
    ).resolves.toMatchObject({
      id: active.id,
    });
    await expect(
      store.touchAuthSessionByTokenHash(activeHash, new Date(now.getTime() + 30_000)),
    ).resolves.toMatchObject({
      id: active.id,
      lastSeenAt: new Date(now.getTime() + 30_000).toISOString(),
    });
    await expect(
      store.resolveAuthSessionByTokenHash(activeHash, new Date(now.getTime() + 60_000)),
    ).resolves.toBeUndefined();

    const persistedIp = await test.database.query<{
      ip_hint_hash: string;
    }>(
      `SELECT ip_hint_hash
       FROM auth_sessions
       WHERE id = $1`,
      [active.id],
    );
    expect(persistedIp.rows[0].ip_hint_hash).toHaveLength(64);
    expect(persistedIp.rows[0].ip_hint_hash).not.toBe(rawIp);

    const secondHash = hash("revoked-session");
    await store.createAuthSession({
      createdAt: now,
      expiresAt: new Date(now.getTime() + 120_000),
      sessionTokenHash: secondHash,
      userId: user.id,
    });
    const firstRevocation = new Date(now.getTime() + 10_000);
    await store.revokeAuthSessionByTokenHash(secondHash, firstRevocation);
    await store.revokeAuthSessionByTokenHash(secondHash, new Date(now.getTime() + 20_000));
    await expect(
      store.resolveAuthSessionByTokenHash(secondHash, new Date(now.getTime() + 30_000)),
    ).resolves.toBeUndefined();
    await expect(store.findAuthSessionByTokenHash(secondHash)).resolves.toMatchObject({
      revokedAt: firstRevocation.toISOString(),
    });
  });

  it("keeps likes, searches, and filters scoped and idempotent", async () => {
    const test = await harness();
    const store = test.dataPlane.requestStore;
    const first = await createUser(store, "features-one");
    const second = await createUser(store, "features-two");
    await test.dataPlane.listings.upsertObservation(listing("features-listing"));
    const publicListingId = "fixture-provider:request-store-listing";
    const like = await store.upsertLike({
      createdAt: now,
      listingId: publicListingId,
      userId: first.id,
    });
    const duplicateLike = await store.upsertLike({
      createdAt: new Date(now.getTime() + 60_000),
      listingId: publicListingId,
      userId: first.id,
    });

    expect(duplicateLike).toEqual(like);
    await expect(
      store.deleteLike({
        id: like.id,
        userId: second.id,
      }),
    ).resolves.toBe(false);
    await expect(
      store.deleteLike({
        listingId: publicListingId,
        userId: second.id,
      }),
    ).resolves.toBe(false);

    const saved = await store.upsertSavedSearch({
      description: "first",
      label: "Kapital jackets",
      params: "q=kapital&category=jackets",
      userId: first.id,
    });
    const updated = await store.upsertSavedSearch({
      description: "updated",
      label: "Updated label",
      params: "q=kapital&category=jackets",
      userId: first.id,
    });
    await store.upsertSavedSearch({
      description: "other user",
      label: "Other label",
      params: "q=kapital&category=jackets",
      userId: second.id,
    });
    expect(updated).toMatchObject({
      description: "updated",
      id: saved.id,
      label: "Updated label",
    });
    await expect(
      store.deleteSavedSearch({
        id: saved.id,
        userId: second.id,
      }),
    ).resolves.toBe(false);

    const filter = await store.upsertSavedFilter({
      label: "Under 300",
      listingType: "buy_now",
      maxPrice: 300,
      queryText: "kapital",
      source: "fixture-provider",
      userId: first.id,
    });
    const updatedFilter = await store.upsertSavedFilter({
      label: "Renamed",
      listingType: "buy_now",
      maxPrice: 300,
      queryText: "kapital",
      source: "fixture-provider",
      userId: first.id,
    });
    expect(updatedFilter).toMatchObject({
      id: filter.id,
      label: "Renamed",
    });

    for (let index = 0; index < 9; index += 1) {
      await store.upsertRecentSearch({
        description: `Recent ${index}`,
        label: `Recent ${index}`,
        params: `q=recent-${index}`,
        userId: first.id,
      });
    }
    await expect(store.listRecentSearchesByUserId(first.id)).resolves.toHaveLength(8);
    await expect(store.listSavedSearchesByUserId(first.id)).resolves.toHaveLength(1);
    await expect(store.listSavedSearchesByUserId(second.id)).resolves.toHaveLength(1);
  });

  it("round-trips watchlists, exact prices, and notification preferences across store instances", async () => {
    const test = await harness();
    const store = test.dataPlane.requestStore;
    const user = await createUser(store, "watchlist-user");
    const other = await createUser(store, "watchlist-other");
    const created = await store.createWatchlist({
      brand: "Kapital",
      enabled: true,
      label: "Kapital under 200",
      maxPriceAmount: 199.99,
      priceCurrency: "usd",
      userId: user.id,
    });
    const persistedListing = await test.dataPlane.listings.upsertObservation(
      listing("watchlist-brand-listing", "watchlist-brand-listing"),
    );
    expect(await test.dataPlane.alerts.matchListing(persistedListing.listingId, now)).toBe(1);
    const restartedStore = new PostgresRequestStore(test.database);

    await expect(restartedStore.listWatchlistsByUserId(user.id)).resolves.toEqual([created]);
    await expect(
      restartedStore.updateWatchlist({
        enabled: false,
        id: created.id,
        userId: other.id,
      }),
    ).resolves.toBeUndefined();
    await expect(
      restartedStore.updateWatchlist({
        enabled: false,
        id: created.id,
        userId: user.id,
      }),
    ).resolves.toMatchObject({
      brand: "Kapital",
      enabled: false,
      maxPriceAmount: 199.99,
      priceCurrency: "USD",
    });

    const money = await test.database.query<{
      brand_text: string;
      max_price_minor: string | number | bigint;
    }>(
      `SELECT brand_text, max_price_minor
       FROM watchlists
       WHERE id = $1`,
      [created.id],
    );
    expect(money.rows[0].brand_text).toBe("Kapital");
    expect(BigInt(money.rows[0].max_price_minor)).toBe(19_999n);

    await expect(restartedStore.getNotificationPreferencesByUserId(user.id)).resolves.toMatchObject(
      {
        emailEnabled: false,
        frequency: "daily",
        inAppEnabled: true,
      },
    );
    await expect(
      restartedStore.updateNotificationPreferences({
        emailEnabled: true,
        frequency: "instant",
        quietHoursEnd: "07:30",
        quietHoursStart: "22:00",
        userId: user.id,
      }),
    ).resolves.toMatchObject({
      emailEnabled: true,
      frequency: "instant",
      quietHoursEnd: "07:30",
      quietHoursStart: "22:00",
    });
  });

  it("exports only safe account data and cascades request-owned rows on deletion", async () => {
    const test = await harness();
    const store = new PostgresRequestStore(test.database, {
      ipHintPepper: "x".repeat(32),
      nodeEnv: "production",
    });
    const user = await createUser(store, "delete-me");
    await test.dataPlane.listings.upsertObservation(listing("delete-listing", "delete-listing"));
    const identity = await store.upsertEmailIdentity({
      email: "delete@example.com",
      userId: user.id,
    });
    const tokenHash = hash("delete-token");
    const sessionHash = hash("delete-session");
    const rawIp = "198.51.100.8";
    await store.issueAccountToken({
      expiresAt: new Date(now.getTime() + 60_000),
      emailIdentityId: identity.id,
      purpose: "account_export",
      tokenHash,
      userId: user.id,
    });
    await store.createAuthSession({
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ipHint: rawIp,
      sessionTokenHash: sessionHash,
      userId: user.id,
    });
    await store.upsertLike({
      listingId: "fixture-provider:delete-listing",
      userId: user.id,
    });
    await store.upsertSavedSearch({
      description: "delete",
      label: "delete",
      params: "q=delete",
      userId: user.id,
    });
    await store.upsertSavedFilter({
      label: "delete",
      queryText: "delete",
      userId: user.id,
    });
    await store.createWatchlist({
      label: "delete",
      queryText: "delete",
      userId: user.id,
    });
    await store.updateNotificationPreferences({
      inAppEnabled: true,
      userId: user.id,
    });

    const exported = await store.exportAccountData(user.id, now);
    const serialized = JSON.stringify(exported);
    expect(exported).toMatchObject({
      account: {
        id: user.id,
        username: "delete-me",
      },
      schemaVersion: 2,
    });
    expect(serialized).not.toContain(passwordHash);
    expect(serialized).not.toContain(tokenHash);
    expect(serialized).not.toContain(sessionHash);
    expect(serialized).not.toContain(rawIp);

    await expect(store.deleteAccount(user.id, "delete-me")).resolves.toBe(true);
    await expect(store.findUserById(user.id)).resolves.toBeUndefined();
    await expect(store.exportAccountData(user.id)).resolves.toBeUndefined();

    for (const table of [
      "account_tokens",
      "auth_sessions",
      "likes",
      "notification_preferences",
      "saved_filters",
      "saved_searches",
      "user_identities",
      "user_settings",
      "watchlists",
    ]) {
      const result = await test.database.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM ${table}
         WHERE user_id = $1`,
        [user.id],
      );
      expect(result.rows[0].count, table).toBe("0");
    }

    const listingCount = await test.database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM listings
       WHERE provider_id = 'fixture-provider'
         AND source_listing_id = 'delete-listing'`,
    );
    expect(listingCount.rows[0].count).toBe("1");
  });

  it("surfaces typed validation failures at the gateway boundary", async () => {
    const test = await harness();

    await expect(test.dataPlane.requestStore.findUserById("not-a-uuid")).rejects.toBeInstanceOf(
      RequestStoreError,
    );
  });
});
