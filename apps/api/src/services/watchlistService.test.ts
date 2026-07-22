import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupIsolatedDatabase, useIsolatedDatabase } from "../db/test-helpers.js";
import { createUser, resetUserStore } from "../user-service.js";
import {
  buildWatchlistLabel,
  createWatchlist,
  getWatchlistsByUserId,
  resetWatchlistStore,
  updateWatchlist,
} from "./watchlistService.js";

describe("watchlistService", () => {
  let databasePath = "";

  beforeEach(() => {
    databasePath = useIsolatedDatabase("watchlist-service");
    resetUserStore();
    resetWatchlistStore();
  });

  afterEach(() => {
    cleanupIsolatedDatabase(databasePath);
  });

  it("generates useful fallback labels from watch criteria", () => {
    expect(
      buildWatchlistLabel({
        brand: "Rick Owens",
        maxPriceAmount: 300,
        priceCurrency: "USD",
      }),
    ).toBe("Rick Owens under $300");

    expect(
      buildWatchlistLabel({
        queryText: "archive denim",
      }),
    ).toBe("Archive Denim search");

    expect(
      buildWatchlistLabel({
        category: "leather jackets",
        source: "grailed",
      }),
    ).toBe("Leather Jackets");
  });

  it("creates and partially updates watchlists while preserving existing criteria", () => {
    const signup = createUser("watchservice", "mohaircoat");

    const created = createWatchlist({
      userId: signup.userId,
      brand: "Kapital",
      maxPriceAmount: 250,
      priceCurrency: "USD",
      source: "grailed",
    });

    expect(created).toMatchObject({
      brand: "Kapital",
      enabled: true,
      label: "Kapital under $250",
      maxPriceAmount: 250,
      source: "grailed",
    });

    const updated = updateWatchlist({
      id: created.id,
      userId: signup.userId,
      category: "jackets",
      enabled: false,
    });

    expect(updated).toMatchObject({
      brand: "Kapital",
      category: "jackets",
      enabled: false,
      maxPriceAmount: 250,
      source: "grailed",
    });

    expect(getWatchlistsByUserId(signup.userId)).toEqual([updated]);
  });

  it("rejects empty criteria and invalid price ranges", () => {
    const signup = createUser("watcherrors", "mohaircoat");

    expect(() =>
      createWatchlist({
        userId: signup.userId,
      }),
    ).toThrowError(
      "Add at least one watch criterion like a brand, query, category, source, size, condition, or price range.",
    );

    expect(() =>
      createWatchlist({
        userId: signup.userId,
        brand: "Kapital",
        minPriceAmount: 400,
        maxPriceAmount: 200,
        priceCurrency: "USD",
      }),
    ).toThrowError("Max price cannot be lower than min price.");
  });
});
