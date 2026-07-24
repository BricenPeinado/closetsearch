import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  AppLayout,
  buildWatchlistPayloadFromSearch,
  createWatchlistDraftFromSearch,
  getProviderAvailabilityMessage,
  getHomeFeedPresentation,
} from "./app";

describe("AppLayout", () => {
  it.each([
    { path: "/", title: "Find your next piece" },
    { path: "/search", title: "Search" },
    { path: "/recent-searches", title: "Recent Searches" },
    { path: "/analytics", title: "Premium Analytics" },
    { path: "/alerts", title: "Alerts" },
    { path: "/beta", title: "Beta Information" },
    { path: "/profile", title: "Profile" },
    { path: "/signup", title: "Create Your Account" },
    { path: "/login", title: "Log In" },
    { path: "/forgot-password", title: "Reset your password" },
    { path: "/reset-password?token=reset-token", title: "Choose a new password" },
    { path: "/verify-email?token=verify-token", title: "Verify your email" },
    { path: "/account/export?token=export-token", title: "Download account export" },
    { path: "/onboarding", title: "Tell us what you like" },
    { path: "/brands", title: "Brands" },
    { path: "/brands/kapital", title: "Brand Profile" },
    { path: "/not-a-route", title: "Page not found" },
  ])("renders $path", ({ path, title }) => {
    const html = renderToString(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(html).toContain(title);
    expect(html).toContain("Home");
    expect(html).toContain("Search");
    expect(html).toContain("Profile");
  });

  it("shows a signed-out watchlist prompt on active search routes", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/search?q=kapital&source=grailed&maxPrice=250"]}>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(html).toContain("Log in to save searches, filters, and watchlists.");
    expect(html).toContain(
      "Watchlists save what you want to track. In-app matches require the production PostgreSQL",
    );
  });

  it("shows the signed-out profile prompt with watchlists in the account copy", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/profile"]}>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(html).toContain("Profile needs an account");
    expect(html).toContain(
      "Log in or create an account to save likes, searches, filters, watchlists, and settings.",
    );
  });

  it("renders beta privacy, data-use, and feedback copy", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/beta"]}>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(html).toContain("Beta privacy and data use");
    expect(html).toContain("Observed analytics only");
    expect(html).toContain("Alert delivery has explicit dependencies");
    expect(html).toContain("Beta feedback");
    expect(html).toContain("Constrained beta");
  });
});

describe("watchlist helpers", () => {
  it("creates a watchlist draft from active search filters", () => {
    expect(
      createWatchlistDraftFromSearch(
        {
          query: "  kapital  ",
          source: "grailed",
          listingType: "auction",
          minPrice: "150",
          maxPrice: "350",
          sort: "newest",
        },
        "EUR",
      ),
    ).toEqual({
      brand: "",
      category: "",
      condition: "",
      enabled: true,
      label: "",
      listingType: "auction",
      maxPriceAmount: "350",
      minPriceAmount: "150",
      priceCurrency: "EUR",
      queryText: "kapital",
      size: "",
      source: "grailed",
    });
  });

  it("builds a watchlist payload from search filters with parsed prices", () => {
    expect(
      buildWatchlistPayloadFromSearch(
        {
          query: " leather jacket ",
          source: "grailed",
          listingType: "buy_now",
          minPrice: "100",
          maxPrice: "250",
          sort: "relevance",
        },
        "USD",
      ),
    ).toEqual({
      brand: undefined,
      category: undefined,
      condition: undefined,
      enabled: true,
      label: undefined,
      listingType: "buy_now",
      maxPriceAmount: 250,
      minPriceAmount: 100,
      priceCurrency: "USD",
      queryText: "leather jacket",
      size: undefined,
      source: "grailed",
    });
  });
});

describe("provider availability messaging", () => {
  it("returns undefined when every provider succeeds", () => {
    expect(
      getProviderAvailabilityMessage(
        [
          {
            providerId: "mock",
            providerName: "Mock Closet",
            resultCount: 4,
            status: "success",
          },
        ],
        "search",
      ),
    ).toBeUndefined();
  });

  it("explains when a marketplace failure limits beta results", () => {
    expect(
      getProviderAvailabilityMessage(
        [
          {
            providerId: "mock",
            providerName: "Mock Closet",
            resultCount: 4,
            status: "success",
          },
          {
            providerId: "grailed",
            providerName: "Grailed",
            resultCount: 0,
            status: "failure",
          },
        ],
        "search",
      ),
    ).toContain("Grailed was unavailable");
  });
});

describe("getHomeFeedPresentation", () => {
  const session = {
    userId: "user-1",
    user: {
      id: "user-1",
      username: "archivist",
      currencyPreference: "USD",
      createdAt: "2026-07-12T12:00:00.000Z",
      onboardingPreferences: {
        favoriteBrands: ["Kapital"],
        categories: ["outerwear"],
        priceRange: "$150-$400",
      },
    },
  };

  it("shows personalized copy for signed-in users with signals", () => {
    expect(
      getHomeFeedPresentation(session, {
        isPersonalized: true,
        message: "Personalized from your likes, saved searches, and preferences.",
        signalCount: 3,
        signalLabels: ["likes", "saved searches", "preferred sources"],
      }),
    ).toEqual({
      chipLabel: "For You",
      introCopy: "Personalized from your likes, saved searches, and preferences.",
    });
  });

  it("keeps signed-out users on generic feed copy", () => {
    expect(getHomeFeedPresentation(null)).toEqual({
      chipLabel: "Trending",
      introCopy: "Popular finds across resale marketplaces.",
    });
  });

  it("handles low-signal signed-in states without crashing", () => {
    expect(
      getHomeFeedPresentation(session, {
        isPersonalized: false,
        message: "Like listings or save a search to personalize this feed.",
        signalCount: 0,
        signalLabels: [],
      }),
    ).toEqual({
      chipLabel: "Fresh Picks",
      introCopy: "Like listings or save a search to personalize this feed.",
    });
  });
});
