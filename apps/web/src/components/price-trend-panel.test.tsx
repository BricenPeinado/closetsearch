import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatTrendChange, PriceTrendPanel } from "./price-trend-panel";

describe("PriceTrendPanel", () => {
  it("announces separated observation semantics while history loads", () => {
    const html = renderToString(
      <PriceTrendPanel listingId="mock:listing-1" locale="en-US" timeZone="UTC" />,
    );

    expect(html).toContain("Price history");
    expect(html).toContain("confirmed sales");
    expect(html).toContain("auction bids");
    expect(html).toContain("Loading observed price history");
    expect(html).toContain("Price history time window");
  });

  it("formats backend trend deltas from explicit percentage points", () => {
    expect(
      formatTrendChange({
        absoluteMinor: -720,
        baselineAmountMinor: 26_520,
        baselineObservedAt: "2026-06-26T12:00:00.000Z",
        percent: -2.7149,
      }),
    ).toBe("-2.7%");
    expect(formatTrendChange(null)).toBe("Not enough data");
  });
});
