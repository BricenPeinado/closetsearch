import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabaseConnection } from "./db/database.js";
import { seedDatabase } from "./db/seed.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "./db/test-helpers.js";
import {
  addLike,
  getLikedListingsByUserId,
  getLikesByUserId,
  resetLikeStore,
} from "./like-service.js";
import {
  addRecentSearch,
  getRecentSearchesByUserId,
  resetRecentSearchStore,
} from "./recent-search-service.js";
import {
  addSavedSearch,
  getSavedSearchesByUserId,
  removeSavedSearch,
  resetSavedSearchStore,
} from "./saved-search-service.js";
import {
  addSavedFilter,
  getSavedFiltersByUserId,
  removeSavedFilter,
  resetSavedFilterStore,
} from "./saved-filter-service.js";
import {
  getRememberedListing,
  rememberListings,
  resetListingCatalog,
} from "./services/listingCatalogService.js";
import {
  getObservedPriceSnapshots,
  recordObservedListings,
  resetPriceSnapshotStore,
} from "./services/priceSnapshotService.js";
import { getAlertPreferencesByUserId } from "./services/alertPreferenceService.js";
import {
  createUser,
  getUserById,
  loginUser,
  resetUserStore,
  saveOnboardingPreferences,
} from "./user-service.js";
import {
  getSettingsByUserId,
  resetUserSettingsStore,
  updateSettings,
} from "./user-settings-service.js";
import {
  addWatchlist,
  getWatchlistsByUserId,
  removeWatchlist,
  resetWatchlistStore,
} from "./watchlist-service.js";

const testListing = {
  id: "grailed:listing-123",
  providerId: "grailed",
  providerListingId: "listing-123",
  source: {
    id: "grailed",
    name: "Grailed",
  },
  sourceUrl: "https://www.grailed.com/listings/123",
  title: "Archive bomber jacket",
  brand: {
    id: "brand:our-legacy",
    slug: "our-legacy",
    name: "Our Legacy",
  },
  imageUrl: "https://cdn.example.com/archive-bomber.jpg",
  price: {
    amount: 280,
    currency: "USD",
  },
  listingType: "buy_now" as const,
  fetchedAt: "2026-07-02T12:00:00.000Z",
};

function waitForNextTick() {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

describe("database persistence services", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("persistence");
    resetUserStore();
    resetLikeStore();
    resetRecentSearchStore();
    resetSavedSearchStore();
    resetSavedFilterStore();
    resetWatchlistStore();
    resetUserSettingsStore();
    resetListingCatalog();
    resetPriceSnapshotStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("persists users across database reinitialization", () => {
    const signup = createUser("archivekid", "mohaircoat");

    closeDatabaseConnection();

    const login = loginUser("archivekid", "mohaircoat");

    expect(login.userId).toBe(signup.userId);
    expect(login.user.username).toBe("archivekid");
  });

  it("seeds demo data idempotently without duplicating beta fixtures", () => {
    seedDatabase();
    seedDatabase();

    closeDatabaseConnection();

    const demoLogin = loginUser("closetdemo", "closetdemo");
    const savedSearches = getSavedSearchesByUserId(demoLogin.userId);
    const savedFilters = getSavedFiltersByUserId(demoLogin.userId);
    const watchlists = getWatchlistsByUserId(demoLogin.userId);
    const recentSearches = getRecentSearchesByUserId(demoLogin.userId);
    const settings = getSettingsByUserId(demoLogin.userId);
    const notificationPreferences = getAlertPreferencesByUserId(demoLogin.userId);
    const observedSnapshots = getObservedPriceSnapshots();

    expect(recentSearches).toHaveLength(1);
    expect(savedSearches).toHaveLength(1);
    expect(savedFilters).toHaveLength(1);
    expect(watchlists).toHaveLength(1);
    expect(watchlists[0]).toMatchObject({
      brand: "Kapital",
      category: "jackets",
      enabled: true,
      label: "Kapital under $300",
    });
    expect(settings).toMatchObject({
      displayName: "Closet Demo",
      preferredCurrency: "USD",
      preferredSources: ["grailed", "mock"],
    });
    expect(notificationPreferences).toMatchObject({
      emailEnabled: false,
      frequency: "daily",
      inAppEnabled: true,
      pushEnabled: false,
      quietHoursEnd: "08:00",
      quietHoursStart: "22:00",
      smsEnabled: false,
      userId: demoLogin.userId,
    });
    expect(observedSnapshots).toHaveLength(6);
  });

  it("persists onboarding preferences across database reinitialization", () => {
    const signup = createUser("closetlover", "jacketcoat");

    saveOnboardingPreferences(signup.userId, {
      favoriteBrands: ["Our Legacy", "Acne Studios"],
      categories: ["jackets", "knitwear"],
      priceRange: "$100-$300",
    });

    closeDatabaseConnection();

    expect(getUserById(signup.userId)).toMatchObject({
      onboardingPreferences: {
        favoriteBrands: ["Our Legacy", "Acne Studios"],
        categories: ["jackets", "knitwear"],
        priceRange: "$100-$300",
      },
    });
  });

  it("persists liked listings with snapshots and dedupes duplicate likes", () => {
    const signup = createUser("liker", "heartcoat");

    const firstLike = addLike({
      userId: signup.userId,
      listingId: testListing.id,
      source: testListing.source.id,
      listing: testListing,
    });
    const secondLike = addLike({
      userId: signup.userId,
      listingId: testListing.id,
      source: testListing.source.id,
      listing: testListing,
    });

    expect(secondLike.like.id).toBe(firstLike.like.id);

    closeDatabaseConnection();

    const likes = getLikesByUserId(signup.userId);
    const likedListings = getLikedListingsByUserId(signup.userId);

    expect(likes).toHaveLength(1);
    expect(likedListings).toHaveLength(1);
    expect(likedListings[0]).toMatchObject({
      like: {
        listingId: testListing.id,
        source: "grailed",
      },
      listing: {
        id: testListing.id,
        title: testListing.title,
        sourceUrl: testListing.sourceUrl,
      },
    });
  });

  it("persists recent searches with dedupe, ordering, and an 8-item limit", async () => {
    const signup = createUser("searchfan", "threadcoat");

    addRecentSearch({
      userId: signup.userId,
      label: "jacket",
      description: "Keyword search",
      params: "q=jacket",
    });
    await waitForNextTick();
    addRecentSearch({
      userId: signup.userId,
      label: "coat",
      description: "Keyword search",
      params: "q=coat",
    });
    await waitForNextTick();
    addRecentSearch({
      userId: signup.userId,
      label: "jacket",
      description: "Price low to high",
      params: "q=jacket",
    });

    for (let index = 0; index < 7; index += 1) {
      await waitForNextTick();
      addRecentSearch({
        userId: signup.userId,
        label: `search ${index}`,
        description: "Keyword search",
        params: `q=search-${index}`,
      });
    }

    closeDatabaseConnection();

    const recentSearches = getRecentSearchesByUserId(signup.userId);

    expect(recentSearches).toHaveLength(8);
    expect(recentSearches[0]).toMatchObject({
      params: "q=search-6",
    });
    expect(recentSearches.some((entry) => entry.params === "q=coat")).toBe(false);
    expect(recentSearches.filter((entry) => entry.params === "q=jacket")).toHaveLength(1);
  });

  it("persists saved searches and supports delete by params", () => {
    const signup = createUser("saver", "knitscoat");

    addSavedSearch({
      userId: signup.userId,
      label: "Archive outerwear",
      description: "grailed • Price high to low",
      params: "q=archive+outerwear&source=grailed&sort=price_desc",
    });
    addSavedSearch({
      userId: signup.userId,
      label: "Knitwear",
      description: "grailed • Newest first",
      params: "q=knitwear&source=grailed&sort=newest",
    });

    expect(
      removeSavedSearch({
        userId: signup.userId,
        params: "q=archive+outerwear&source=grailed&sort=price_desc",
      }),
    ).toBe(true);

    closeDatabaseConnection();

    const savedSearches = getSavedSearchesByUserId(signup.userId);

    expect(savedSearches).toHaveLength(1);
    expect(savedSearches[0]).toMatchObject({
      label: "Knitwear",
    });
  });

  it("persists saved filters, dedupes by params, and supports delete", () => {
    const signup = createUser("filterfan", "filtercoat");

    const firstFilter = addSavedFilter({
      userId: signup.userId,
      label: "Kapital preset",
      queryText: "kapital",
      source: "grailed",
      minPrice: 100,
      maxPrice: 250,
      sortMode: "newest",
    });
    const secondFilter = addSavedFilter({
      userId: signup.userId,
      label: "Kapital updated",
      queryText: "kapital",
      source: "grailed",
      minPrice: 100,
      maxPrice: 250,
      sortMode: "newest",
    });

    expect(secondFilter.id).toBe(firstFilter.id);
    expect(secondFilter.label).toBe("Kapital updated");
    expect(removeSavedFilter({ userId: signup.userId, id: secondFilter.id })).toBe(true);

    closeDatabaseConnection();

    expect(getSavedFiltersByUserId(signup.userId)).toEqual([]);
  });

  it("persists watchlist shell items and supports delete", () => {
    const signup = createUser("watcher", "watchcoat");

    const watchlist = addWatchlist({
      userId: signup.userId,
      label: "Kapital under $250",
      queryText: "kapital",
      brand: "Kapital",
      maxPriceAmount: 250,
      source: "grailed",
    });

    closeDatabaseConnection();

    const watchlists = getWatchlistsByUserId(signup.userId);
    expect(watchlists).toHaveLength(1);
    expect(watchlists[0]).toMatchObject({
      label: "Kapital under $250",
      source: "grailed",
    });

    expect(removeWatchlist({ userId: signup.userId, id: watchlist.id })).toBe(true);
    expect(getWatchlistsByUserId(signup.userId)).toEqual([]);
  });

  it("persists user settings across database reinitialization", () => {
    const signup = createUser("settingsfan", "settingcoat");

    updateSettings({
      userId: signup.userId,
      preferredCurrency: "EUR",
      defaultSortMode: "newest",
      preferredSources: ["grailed", "mock"],
      displayName: "Archive Hunter",
    });

    closeDatabaseConnection();

    expect(getSettingsByUserId(signup.userId)).toMatchObject({
      preferredCurrency: "EUR",
      defaultSortMode: "newest",
      preferredSources: ["grailed", "mock"],
      displayName: "Archive Hunter",
    });
  });

  it("persists observed price snapshots across database reinitialization", () => {
    recordObservedListings([testListing]);

    closeDatabaseConnection();

    expect(getObservedPriceSnapshots()).toMatchObject([
      expect.objectContaining({
        listingId: testListing.id,
        normalizedPriceAmount: 280,
        normalizedPriceCurrency: "USD",
      }),
    ]);
  });

  it("persists the listing cache across database reinitialization", () => {
    rememberListings([testListing]);

    closeDatabaseConnection();

    expect(getRememberedListing(testListing.id)).toMatchObject({
      id: testListing.id,
      title: testListing.title,
      source: {
        id: "grailed",
      },
    });
  });

  it("supports seed data after migrations run", () => {
    seedDatabase();

    closeDatabaseConnection();

    const login = loginUser("closetdemo", "closetdemo");
    const savedSearches = getSavedSearchesByUserId(login.userId);

    expect(login.user.username).toBe("closetdemo");
    expect(savedSearches).toHaveLength(1);
  });
});
