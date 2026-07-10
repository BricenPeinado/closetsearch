import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabaseConnection } from "./db/database.js";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "./db/test-helpers.js";
import { addLike, getLikesByUserId, resetLikeStore } from "./like-service.js";
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
  getRememberedListing,
  rememberListings,
  resetListingCatalog,
} from "./services/listingCatalogService.js";
import { createUser, getUserById, loginUser, resetUserStore, saveOnboardingPreferences } from "./user-service.js";
import { seedDatabase } from "./db/seed.js";

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
    resetListingCatalog();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("persists users across database reinitialization", () => {
    const signup = createUser("archivekid", "mohair");

    closeDatabaseConnection();

    const login = loginUser("archivekid", "mohair");

    expect(login.userId).toBe(signup.userId);
    expect(login.user.username).toBe("archivekid");
  });

  it("persists onboarding preferences across database reinitialization", () => {
    const signup = createUser("closetlover", "jacket");

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

  it("persists likes and dedupes duplicate likes", () => {
    const signup = createUser("liker", "heart");

    const firstLike = addLike(signup.userId, testListing.id, testListing.source.id);
    const secondLike = addLike(signup.userId, testListing.id, testListing.source.id);

    expect(secondLike.id).toBe(firstLike.id);

    closeDatabaseConnection();

    const likes = getLikesByUserId(signup.userId);

    expect(likes).toHaveLength(1);
    expect(likes[0]).toMatchObject({
      listingId: testListing.id,
      source: "grailed",
    });
  });

  it("persists recent searches with dedupe, ordering, and an 8-item limit", async () => {
    const signup = createUser("searchfan", "thread");

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
    const signup = createUser("saver", "knits");

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
