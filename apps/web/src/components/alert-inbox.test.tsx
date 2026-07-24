import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AlertInboxPage, describeAlertReasons } from "./alert-inbox";

describe("alert inbox", () => {
  it("formats match reasons without exposing internal codes", () => {
    expect(
      describeAlertReasons([
        { code: "brand_match", label: "Brand matched" },
        { code: "price_match", label: "Price range matched" },
      ]),
    ).toBe("Brand matched • Price range matched");
    expect(describeAlertReasons([])).toBe("Watchlist criteria matched");
  });

  it("shows a signed-out login state and truthful delivery dependencies", () => {
    const signedOutHtml = renderToString(
      <MemoryRouter>
        <AlertInboxPage onAuthFailure={vi.fn()} session={null} />
      </MemoryRouter>,
    );

    expect(signedOutHtml).toContain("Log in to view alerts");
    expect(signedOutHtml).toContain('href="/login"');
  });

  it("renders a durable-inbox loading state for an authenticated session", () => {
    const html = renderToString(
      <MemoryRouter>
        <AlertInboxPage
          onAuthFailure={vi.fn()}
          session={{
            userId: "user-1",
            user: {
              createdAt: "2026-07-24T12:00:00.000Z",
              currencyPreference: "USD",
              id: "user-1",
              onboardingPreferences: {
                categories: [],
                favoriteBrands: [],
                priceRange: "",
              },
              username: "archivist",
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Checking your durable in-app inbox");
    expect(html).toContain("production PostgreSQL worker");
    expect(html).toContain("Push and SMS are unavailable");
  });
});
