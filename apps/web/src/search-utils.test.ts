import { describe, expect, it } from "vitest";
import {
  buildSearchPath,
  clearRecentSearches,
  createSearchParams,
  describeSearch,
  hasActiveSearchValues,
  loadRecentSearches,
  mergeRecentSearchEntries,
  parseSearchFormValues,
  saveRecentSearch,
  type RecentSearchEntry,
} from "./search-utils";

function createMemoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("search utils", () => {
  it("parses and rebuilds search params used by the search page", () => {
    const values = parseSearchFormValues(
      new URLSearchParams(
        "q=jacket&sort=price_asc&source=mock&listingType=auction&minPrice=100&maxPrice=250",
      ),
    );

    expect(values).toEqual({
      brand: "",
      category: "",
      condition: "",
      currency: "",
      query: "jacket",
      sort: "price_asc",
      source: "mock",
      listingType: "auction",
      marketStatus: "",
      minPrice: "100",
      maxPrice: "250",
      size: "",
    });

    expect(createSearchParams(values).toString()).toBe(
      "q=jacket&sort=price_asc&source=mock&listingType=auction&minPrice=100&maxPrice=250",
    );
    expect(buildSearchPath(values)).toBe(
      "/search?q=jacket&sort=price_asc&source=mock&listingType=auction&minPrice=100&maxPrice=250",
    );
  });

  it("round-trips normalized marketplace filters through the URL", () => {
    const values = parseSearchFormValues(
      new URLSearchParams(
        "brands=Kapital&categories=jackets&sizes=M&conditions=excellent&marketScope=sold&currency=eur",
      ),
    );

    expect(values).toMatchObject({
      brand: "Kapital",
      category: "jackets",
      condition: "excellent",
      currency: "EUR",
      marketStatus: "sold",
      size: "M",
    });
    expect(createSearchParams(values).toString()).toBe(
      "brands=Kapital&categories=jackets&sizes=M&conditions=excellent&marketScope=sold&currency=EUR",
    );
    expect(hasActiveSearchValues(values)).toBe(true);
  });

  it("builds a filter-only search path when query text is empty", () => {
    const values = {
      query: "",
      sort: "newest" as const,
      source: "grailed",
      listingType: "buy_now" as const,
      minPrice: "120",
      maxPrice: "260",
    };

    expect(hasActiveSearchValues(values)).toBe(true);
    expect(buildSearchPath(values)).toBe(
      "/search?sort=newest&source=grailed&listingType=buy_now&minPrice=120&maxPrice=260",
    );
  });

  it.each(["ending_soon", "popularity", "recommended"] as const)(
    "round-trips the %s product sort through the URL",
    (sort) => {
      const values = parseSearchFormValues(new URLSearchParams(`q=coat&sort=${sort}`));

      expect(values.sort).toBe(sort);
      expect(createSearchParams(values).toString()).toBe(`q=coat&sort=${sort}`);
      expect(describeSearch(values)).toContain(
        sort === "ending_soon"
          ? "Ending soon"
          : sort === "popularity"
            ? "Most popular"
            : "Recommended",
      );
    },
  );

  it("describes active filters in recent searches", () => {
    expect(
      describeSearch({
        query: "jacket",
        sort: "price_desc",
        source: "mock",
        listingType: "buy_now",
        minPrice: "120",
        maxPrice: "260",
      }),
    ).toBe("mock • Fixed price • Price high to low • $120 to $260");
  });

  it("deduplicates recent searches by params", () => {
    const entries: RecentSearchEntry[] = [
      {
        id: "q=coat",
        label: "coat",
        description: "Keyword search",
        params: "q=coat",
        createdAt: "2026-05-04T12:00:00.000Z",
      },
    ];

    const mergedEntries = mergeRecentSearchEntries(entries, {
      id: "q=coat",
      label: "coat",
      description: "Price low to high",
      params: "q=coat",
      createdAt: "2026-05-04T12:05:00.000Z",
    });

    expect(mergedEntries).toHaveLength(1);
    expect(mergedEntries[0]?.description).toBe("Price low to high");
  });

  it("stores and clears recent searches in local storage format", () => {
    const storage = createMemoryStorage();

    saveRecentSearch(
      {
        query: "jacket",
        sort: "price_asc",
        source: "mock",
        listingType: "auction",
        minPrice: "90",
        maxPrice: "",
      },
      storage,
    );

    expect(loadRecentSearches(storage)).toMatchObject([
      {
        label: "jacket",
        description: "mock • Auction • Price low to high • $90+",
        params: "q=jacket&sort=price_asc&source=mock&listingType=auction&minPrice=90",
      },
    ]);

    clearRecentSearches(storage);

    expect(loadRecentSearches(storage)).toEqual([]);
  });
});
