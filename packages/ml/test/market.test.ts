import { describe, expect, it } from "vitest";
import {
  detectFairValueDrift,
  estimateMarketValue,
  predictFairValue,
  selectComparableListings,
  trainFairValueModel,
} from "../src/index.js";
import { marketFixture } from "./fixtures.js";

describe("fair-value model and safe fallback", () => {
  it("predicts from sold outcomes without reading the active asking price", () => {
    const snapshot = marketFixture();
    const artifact = trainFairValueModel({ snapshot });
    const target = snapshot.observations.find(
      (observation) => observation.observationId === "active-rick",
    )!;
    const changedAskingPrice = {
      ...target,
      askingPriceMinor: 1,
    };

    expect(predictFairValue(artifact, target)).toEqual(
      predictFairValue(artifact, changedAskingPrice),
    );
  });

  it("selects same-brand/category/currency sold comparables only", () => {
    const snapshot = marketFixture();
    const target = snapshot.observations.find(
      (observation) => observation.observationId === "active-rick",
    )!;
    const comparables = selectComparableListings(
      target,
      snapshot.observations,
      "2026-09-10T12:00:00.000Z",
    );

    expect(comparables.length).toBeGreaterThanOrEqual(8);
    expect(
      comparables.every(
        ({ observation }) =>
          observation.status === "sold" &&
          observation.canonicalBrand === "Rick Owens" &&
          observation.category === "jackets" &&
          observation.normalizedCurrency === "USD",
      ),
    ).toBe(true);
  });

  it("uses observed ranges while the fixture model is shadow-only and under-calibrated", () => {
    const snapshot = marketFixture();
    const artifact = trainFairValueModel({ snapshot });
    const target = snapshot.observations.find(
      (observation) => observation.observationId === "active-rick",
    )!;
    const result = estimateMarketValue({
      artifact,
      asOf: "2026-09-10T12:00:00.000Z",
      observations: snapshot.observations,
      target,
    });

    expect(result.status).toBe("observed_range");
    expect(result.observedRange?.comparableCount).toBeGreaterThanOrEqual(4);
    expect(result.reasonCodes).toContain("model_not_promoted");
    expect(result.reasonCodes).toContain("insufficient_model_calibration");
    expect(result.wording).toBe("Based on observed comparable listings");
    expect(result.disclaimer).not.toMatch(/guaranteed|profit|investment/i);
  });

  it("returns limited data instead of extrapolating an unsupported segment", () => {
    const snapshot = marketFixture();
    const artifact = trainFairValueModel({ snapshot });
    const target = {
      ...snapshot.observations.find(
        (observation) => observation.observationId === "active-rick",
      )!,
      canonicalBrand: "Unseen Brand",
      category: "watches",
      listingId: "unseen-active",
      observationId: "unseen-active",
    };
    const result = estimateMarketValue({
      artifact,
      asOf: "2026-09-10T12:00:00.000Z",
      observations: snapshot.observations,
      target,
    });

    expect(result.status).toBe("limited_data");
    expect(result.reasonCodes).toEqual(["minimum_comparable_sample_not_met"]);
  });

  it("detects stale and shifted model inputs", () => {
    const snapshot = marketFixture();
    const artifact = trainFairValueModel({ snapshot });
    const currentRows = snapshot.observations.filter(
      (observation) => observation.status === "active",
    );
    const stale = detectFairValueDrift(
      artifact,
      currentRows,
      "2027-01-15T00:00:00.000Z",
    );
    const shifted = detectFairValueDrift(
      artifact,
      currentRows.map((row, index) => ({
        ...row,
        canonicalBrand: `Unseen Brand ${index}`,
        category: "watches",
        source: "unseen-provider",
      })),
      "2026-09-12T00:00:00.000Z",
    );

    expect(stale.stale).toBe(true);
    expect(stale.reasons).toContain("model_stale");
    expect(shifted.drifted).toBe(true);
    expect(shifted.reasons).toContain("unseen_categorical_rate");
  });
});
