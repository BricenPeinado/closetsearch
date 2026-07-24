import type {
  Listing,
  SavedFilter,
  SavedSearch,
  User,
  UserSettings,
  Watchlist,
} from "@closetsearch/shared";
import { describe, expect, it } from "vitest";
import {
  buildPersonalizationProfile,
  type PersonalizationProfile,
} from "./personalizationSignalsService.js";
import { rankListings } from "./recommendationService.js";

const now = new Date("2026-07-14T12:00:00.000Z").getTime();

function createListing(overrides: Partial<Listing> & { brandName: string; hoursAgo?: number; id: string }) {
  const sourceId = overrides.source?.id ?? "grailed";
  const providerListingId = overrides.providerListingId ?? overrides.id.split(":").pop() ?? overrides.id;
  const hoursAgo = typeof overrides.fetchedAt === "string"
    ? undefined
    : (overrides as Partial<Listing> & { hoursAgo?: number }).hoursAgo ?? 0;

  return {
    id: overrides.id,
    providerId: overrides.providerId ?? sourceId,
    providerListingId,
    source: overrides.source ?? {
      id: sourceId,
      name: sourceId === "grailed" ? "Grailed" : sourceId.toUpperCase(),
    },
    sourceUrl: overrides.sourceUrl ?? `https://${sourceId}.example/listings/${providerListingId}`,
    title: overrides.title ?? `${overrides.brandName} piece`,
    brand: overrides.brand ?? {
      id: `brand:${overrides.brandName.toLowerCase().replace(/\s+/g, "-")}`,
      slug: overrides.brandName.toLowerCase().replace(/\s+/g, "-"),
      name: overrides.brandName,
    },
    imageUrl: overrides.imageUrl ?? `https://cdn.example.com/${providerListingId}.jpg`,
    price: overrides.price ?? {
      amount: 250,
      currency: "USD",
    },
    category: overrides.category,
    size: overrides.size,
    condition: overrides.condition ?? "good",
    listingType: overrides.listingType ?? "buy_now",
    fetchedAt:
      overrides.fetchedAt ?? new Date(now - (hoursAgo ?? 0) * 60 * 60 * 1000).toISOString(),
    seller: overrides.seller,
    market: overrides.market,
    riskSignal: overrides.riskSignal,
  } satisfies Listing;
}

function createUser(overrides?: Partial<User>): User {
  return {
    id: overrides?.id ?? "user-1",
    username: overrides?.username ?? "archivist",
    currencyPreference: overrides?.currencyPreference ?? "USD",
    createdAt: overrides?.createdAt ?? new Date(now).toISOString(),
    onboardingPreferences: overrides?.onboardingPreferences ?? {
      favoriteBrands: [],
      categories: [],
      priceRange: "",
    },
  };
}

function createProfile(options?: {
  likedListings?: Listing[];
  savedFilters?: SavedFilter[];
  savedSearches?: SavedSearch[];
  settings?: UserSettings;
  user?: User;
  watchlists?: Watchlist[];
}): PersonalizationProfile {
  const user = options?.user ?? createUser();

  return buildPersonalizationProfile({
    user,
    likedListings: (options?.likedListings ?? []).map((listing, index) => ({
      like: {
        id: `like-${index + 1}`,
        userId: user.id,
        listingId: listing.id,
        source: listing.source.id,
        createdAt: new Date(now - index * 1000).toISOString(),
      },
      listing,
      snapshotStatus: "snapshot",
    })),
    savedSearches: options?.savedSearches ?? [],
    savedFilters: options?.savedFilters ?? [],
    watchlists: options?.watchlists ?? [],
    settings: options?.settings,
  });
}

describe("rankListings", () => {
  it("boosts listings that match liked brands", () => {
    const likedListing = createListing({
      id: "grailed:liked-kapital",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 48,
    });
    const kapitalCandidate = createListing({
      id: "grailed:kapital-coat",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 18,
    });
    const visvimCandidate = createListing({
      id: "grailed:visvim-coat",
      brandName: "Visvim",
      category: "outerwear",
      hoursAgo: 18,
    });

    const result = rankListings({
      listings: [visvimCandidate, kapitalCandidate],
      profile: createProfile({ likedListings: [likedListing] }),
      includeDebug: true,
    });

    expect(result.isPersonalized).toBe(true);
    expect(result.listings[0]?.brand.name).toBe("Kapital");
    expect(result.debugPersonalization?.scoreBreakdowns[0]?.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "brand_affinity" })]),
    );
  });

  it("boosts categories from onboarding preferences", () => {
    const knitwearListing = createListing({
      id: "grailed:knitwear",
      brandName: "Acne Studios",
      category: "knitwear",
      hoursAgo: 20,
    });
    const pantsListing = createListing({
      id: "grailed:pants",
      brandName: "Acne Studios",
      category: "pants",
      hoursAgo: 20,
    });

    const result = rankListings({
      listings: [pantsListing, knitwearListing],
      profile: createProfile({
        user: createUser({
          onboardingPreferences: {
            favoriteBrands: [],
            categories: ["knitwear"],
            priceRange: "",
          },
        }),
      }),
    });

    expect(result.listings[0]?.category).toBe("knitwear");
  });

  it("uses saved searches and saved filters as soft ranking signals", () => {
    const grailedKapital = createListing({
      id: "grailed:kapital-jacket",
      brandName: "Kapital",
      category: "outerwear",
      price: { amount: 220, currency: "USD" },
      hoursAgo: 14,
    });
    const ebayKapital = createListing({
      id: "ebay:kapital-jacket",
      brandName: "Kapital",
      category: "outerwear",
      source: { id: "ebay", name: "eBay" },
      price: { amount: 220, currency: "USD" },
      hoursAgo: 14,
    });
    const grailedRandom = createListing({
      id: "grailed:random-jacket",
      brandName: "Noah",
      category: "outerwear",
      price: { amount: 220, currency: "USD" },
      hoursAgo: 14,
    });

    const result = rankListings({
      listings: [grailedRandom, ebayKapital, grailedKapital],
      profile: createProfile({
        savedSearches: [
          {
            id: "saved-search-1",
            userId: "user-1",
            label: "Kapital grailed",
            description: "Kapital on Grailed",
            params: "q=kapital&source=grailed",
            createdAt: new Date(now).toISOString(),
          },
        ],
        savedFilters: [
          {
            id: "saved-filter-1",
            userId: "user-1",
            label: "Budget Grailed",
            source: "grailed",
            maxPrice: 250,
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
          },
        ],
      }),
    });

    expect(result.listings[0]?.id).toBe(grailedKapital.id);
    expect(result.listings.some((listing) => listing.source.id === "ebay")).toBe(true);
  });

  it("boosts preferred sources without hard filtering other marketplaces", () => {
    const grailedListing = createListing({
      id: "grailed:source-test",
      brandName: "Visvim",
      category: "outerwear",
      hoursAgo: 16,
    });
    const ebayListing = createListing({
      id: "ebay:source-test",
      brandName: "Visvim",
      category: "outerwear",
      source: { id: "ebay", name: "eBay" },
      hoursAgo: 16,
    });

    const result = rankListings({
      listings: [ebayListing, grailedListing],
      profile: createProfile({
        settings: {
          userId: "user-1",
          preferredCurrency: "USD",
          preferredSources: ["grailed"],
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        },
      }),
    });

    expect(result.listings[0]?.source.id).toBe("grailed");
    expect(result.listings.map((listing) => listing.source.id)).toEqual(
      expect.arrayContaining(["grailed", "ebay"]),
    );
  });

  it("lightly boosts listings near the user price range", () => {
    const inRangeListing = createListing({
      id: "grailed:in-range",
      brandName: "Auralee",
      category: "outerwear",
      price: { amount: 180, currency: "USD" },
      hoursAgo: 24,
    });
    const expensiveListing = createListing({
      id: "grailed:expensive",
      brandName: "Auralee",
      category: "outerwear",
      price: { amount: 900, currency: "USD" },
      hoursAgo: 24,
    });

    const result = rankListings({
      listings: [expensiveListing, inRangeListing],
      profile: createProfile({
        user: createUser({
          onboardingPreferences: {
            favoriteBrands: [],
            categories: [],
            priceRange: "$100-$250",
          },
        }),
      }),
    });

    expect(result.listings[0]?.id).toBe(inRangeListing.id);
  });

  it("keeps very old listings from dominating solely on preference matches", () => {
    const likedListing = createListing({
      id: "grailed:liked-kapital-old",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 72,
    });
    const oldMatchingListing = createListing({
      id: "grailed:old-kapital",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 360,
    });
    const freshAlternative = createListing({
      id: "grailed:fresh-alt",
      brandName: "Auralee",
      category: "outerwear",
      hoursAgo: 2,
    });

    const result = rankListings({
      listings: [oldMatchingListing, freshAlternative],
      profile: createProfile({ likedListings: [likedListing] }),
    });

    expect(result.listings[0]?.id).toBe(freshAlternative.id);
  });

  it("gives complete listings a small quality advantage", () => {
    const completeListing = createListing({
      id: "grailed:complete",
      brandName: "Lemaire",
      category: "outerwear",
      hoursAgo: 30,
    });
    const incompleteListing = createListing({
      id: "grailed:incomplete",
      brandName: "Lemaire",
      category: undefined,
      imageUrl: "",
      sourceUrl: "",
      title: "",
      hoursAgo: 30,
    });

    const result = rankListings({
      listings: [incompleteListing, completeListing],
      profile: createProfile({
        user: createUser({
          onboardingPreferences: {
            favoriteBrands: ["Lemaire"],
            categories: [],
            priceRange: "",
          },
        }),
      }),
    });

    expect(result.listings[0]?.id).toBe(completeListing.id);
  });

  it("keeps the first page from over-repeating a single brand", () => {
    const likedListing = createListing({
      id: "grailed:liked-diversity",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 50,
    });
    const listings = [
      createListing({ id: "grailed:k1", brandName: "Kapital", category: "outerwear", hoursAgo: 10 }),
      createListing({ id: "grailed:k2", brandName: "Kapital", category: "outerwear", hoursAgo: 11 }),
      createListing({ id: "grailed:k3", brandName: "Kapital", category: "outerwear", hoursAgo: 12 }),
      createListing({ id: "grailed:v1", brandName: "Visvim", category: "outerwear", hoursAgo: 9 }),
      createListing({ id: "grailed:u1", brandName: "Undercover", category: "tops", hoursAgo: 8 }),
    ];

    const result = rankListings({
      listings,
      profile: createProfile({ likedListings: [likedListing] }),
    });

    const topBrands = new Set(result.listings.slice(0, 4).map((listing) => listing.brand.name));
    expect(topBrands.size).toBeGreaterThan(1);
  });

  it("removes duplicate listing ids from the feed", () => {
    const duplicateListing = createListing({
      id: "grailed:duplicate",
      brandName: "Stone Island",
      category: "outerwear",
      hoursAgo: 12,
    });
    const uniqueListing = createListing({
      id: "grailed:unique",
      brandName: "Stone Island",
      category: "outerwear",
      hoursAgo: 14,
    });

    const result = rankListings({
      listings: [duplicateListing, { ...duplicateListing }, uniqueListing],
      profile: createProfile({
        user: createUser({
          onboardingPreferences: {
            favoriteBrands: ["Stone Island"],
            categories: [],
            priceRange: "",
          },
        }),
      }),
    });

    expect(new Set(result.listings.map((listing) => listing.id)).size).toBe(result.listings.length);
  });

  it("falls back to a generic newest-first feed for cold-start users", () => {
    const olderListing = createListing({
      id: "grailed:older",
      brandName: "Auralee",
      category: "outerwear",
      hoursAgo: 20,
    });
    const newerListing = createListing({
      id: "grailed:newer",
      brandName: "Auralee",
      category: "outerwear",
      hoursAgo: 2,
    });

    const result = rankListings({
      listings: [olderListing, newerListing],
    });

    expect(result.isPersonalized).toBe(false);
    expect(result.listings.map((listing) => listing.id)).toEqual([
      newerListing.id,
      olderListing.id,
    ]);
    expect(result.personalizationSummary.message).toBe("Popular finds across resale marketplaces.");
  });

  it("returns inspectable score breakdowns when debug is enabled", () => {
    const likedListing = createListing({
      id: "grailed:liked-debug",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 80,
    });
    const candidate = createListing({
      id: "grailed:debug-candidate",
      brandName: "Kapital",
      category: "outerwear",
      hoursAgo: 6,
    });

    const result = rankListings({
      listings: [candidate],
      profile: createProfile({ likedListings: [likedListing] }),
      includeDebug: true,
    });

    expect(result.debugPersonalization?.scoreBreakdowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listingId: candidate.id,
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "brand_affinity" }),
            expect.objectContaining({ code: "freshness" }),
          ]),
        }),
      ]),
    );
  });
});
