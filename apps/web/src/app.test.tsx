import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout, getHomeFeedPresentation } from "./app";

describe("AppLayout", () => {
  it.each([
    { path: "/", title: "Find your next piece" },
    { path: "/search", title: "Search" },
    { path: "/recent-searches", title: "Recent Searches" },
    { path: "/analytics", title: "Premium Analytics" },
    { path: "/profile", title: "Profile" },
    { path: "/signup", title: "Create Your Account" },
    { path: "/login", title: "Log In" },
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
