import marketFixtureJson from "../fixtures/market-snapshot.v1.json";
import recommendationFixtureJson from "../fixtures/recommendation-snapshot.v1.json";
import type {
  MarketSnapshot,
  RecommendationSnapshot,
} from "../src/types.js";

export function recommendationFixture() {
  return structuredClone(
    recommendationFixtureJson,
  ) as unknown as RecommendationSnapshot;
}

export function marketFixture() {
  return structuredClone(marketFixtureJson) as unknown as MarketSnapshot;
}
