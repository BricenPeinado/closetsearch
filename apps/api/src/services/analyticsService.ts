import type {
  AnalyticsOverview,
  MarketInsight,
  UnderpricedListingSignal,
} from "@closetsearch/shared";
import { findBrandBySlug } from "./brandService.js";

function getBrand(slug: string) {
  const brand = findBrandBySlug(slug);

  if (!brand) {
    throw new Error(`Missing mock brand dataset entry for ${slug}.`);
  }

  return brand;
}

const marketInsights: MarketInsight[] = [
  {
    id: "insight:undercover-outerwear-demand",
    brand: getBrand("undercover"),
    category: "outerwear",
    title: "Archive outerwear demand is holding up",
    summary:
      "Sample data suggests strong browse interest around graphic and technical outerwear, especially when sizing is clearly listed.",
    confidence: 0.74,
    createdAt: "2026-05-06T09:15:00.000Z",
  },
  {
    id: "insight:kapital-denim-velocity",
    brand: getBrand("kapital"),
    category: "denim",
    title: "Kapital denim is a strong discovery driver",
    summary:
      "Mock signals show denim and patchwork styles acting as reliable entry points for repeat search behavior.",
    confidence: 0.68,
    createdAt: "2026-05-06T08:35:00.000Z",
  },
  {
    id: "insight:helmut-lang-minimal-tailoring",
    brand: getBrand("helmut-lang"),
    category: "tailoring",
    title: "Minimal tailoring still earns premium attention",
    summary:
      "Placeholder market context indicates clean archive tailoring remains one of the clearest premium research surfaces.",
    confidence: 0.71,
    createdAt: "2026-05-05T19:20:00.000Z",
  },
];

const underpricedSignals: UnderpricedListingSignal[] = [
  {
    id: "signal:mock-jacket-001",
    listingId: "mock:mock-jacket-001",
    source: "Mock Closet",
    listingTitle: "Helmut Lang cropped denim jacket",
    currentPrice: 145,
    estimatedMarketPrice: 205,
    currency: "USD",
    percentBelowMarket: 29,
    confidence: 0.63,
    reason:
      "Sample model flags the listing as below the mock market range relative to comparable archive denim outerwear.",
    createdAt: "2026-05-06T09:45:00.000Z",
  },
  {
    id: "signal:mock-knit-001",
    listingId: "mock:mock-knit-001",
    source: "Mock Closet",
    listingTitle: "Acne Studios mohair striped sweater",
    currentPrice: 185,
    estimatedMarketPrice: 245,
    currency: "USD",
    percentBelowMarket: 24,
    confidence: 0.58,
    reason:
      "Mock comparison suggests the current ask sits below a simple benchmark for similar mohair knitwear listings.",
    createdAt: "2026-05-06T09:10:00.000Z",
  },
  {
    id: "signal:mock-pants-001",
    listingId: "mock:mock-pants-001",
    source: "Mock Closet",
    listingTitle: "Issey Miyake Homme Plisse pleated trousers",
    currentPrice: 240,
    estimatedMarketPrice: 315,
    currency: "USD",
    percentBelowMarket: 24,
    confidence: 0.66,
    reason:
      "Placeholder pricing range indicates the listing is discounted relative to comparable pleated trousers in the sample set.",
    createdAt: "2026-05-06T08:55:00.000Z",
  },
];

const analyticsOverview: AnalyticsOverview = {
  trackedBrands: 12,
  marketInsightCount: marketInsights.length,
  underpricedSignalCount: underpricedSignals.length,
  lastUpdatedAt: "2026-05-06T10:00:00.000Z",
};

export function getAnalyticsOverview() {
  return analyticsOverview;
}

export function getMarketInsights() {
  return marketInsights;
}

export function getUnderpricedListingSignals() {
  return underpricedSignals;
}
