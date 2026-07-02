import type {
  Brand,
  Listing,
  ListingCondition,
  ListingType,
  SearchSortMode,
} from "@closetsearch/shared";
import type { Provider, ProviderSearchQuery, ProviderSearchRequest } from "../types";

const MOCK_PROVIDER_ID = "mock";
const MOCK_PROVIDER_NAME = "Mock Closet";
const defaultMockPageSize = 24;

export interface RawMockListing {
  id: string;
  headline: string;
  designer: string;
  designerSlug: string;
  imageHref: string;
  listingHref: string;
  amount: number;
  currencyCode: string;
  department: string;
  taggedSize?: string;
  wear: ListingCondition;
  purchaseFormat: ListingType;
  indexedAt: string;
}

const rawMockListings: RawMockListing[] = [
  {
    id: "mock-jacket-001",
    headline: "Helmut Lang cropped denim jacket",
    designer: "Helmut Lang",
    designerSlug: "helmut-lang",
    imageHref:
      "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80",
    listingHref: "https://mock.closetsearch.dev/listings/mock-jacket-001",
    amount: 145,
    currencyCode: "USD",
    department: "jackets",
    taggedSize: "M",
    wear: "excellent",
    purchaseFormat: "buy_now",
    indexedAt: "2026-05-04T09:00:00.000Z",
  },
  {
    id: "mock-jacket-002",
    headline: "Our Legacy reversible coach jacket",
    designer: "Our Legacy",
    designerSlug: "our-legacy",
    imageHref:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    listingHref: "https://mock.closetsearch.dev/listings/mock-jacket-002",
    amount: 210,
    currencyCode: "USD",
    department: "jackets",
    taggedSize: "L",
    wear: "good",
    purchaseFormat: "buy_now",
    indexedAt: "2026-05-04T10:30:00.000Z",
  },
  {
    id: "mock-knit-001",
    headline: "Acne Studios mohair striped sweater",
    designer: "Acne Studios",
    designerSlug: "acne-studios",
    imageHref:
      "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=80",
    listingHref: "https://mock.closetsearch.dev/listings/mock-knit-001",
    amount: 185,
    currencyCode: "USD",
    department: "knitwear",
    taggedSize: "S",
    wear: "excellent",
    purchaseFormat: "buy_now",
    indexedAt: "2026-05-03T18:00:00.000Z",
  },
  {
    id: "mock-pants-001",
    headline: "Issey Miyake Homme Plisse pleated trousers",
    designer: "Issey Miyake",
    designerSlug: "issey-miyake",
    imageHref:
      "https://images.unsplash.com/photo-1506629905607-d9b1c9f3c0b0?auto=format&fit=crop&w=900&q=80",
    listingHref: "https://mock.closetsearch.dev/listings/mock-pants-001",
    amount: 240,
    currencyCode: "USD",
    department: "pants",
    taggedSize: "3",
    wear: "excellent",
    purchaseFormat: "buy_now",
    indexedAt: "2026-05-02T15:20:00.000Z",
  },
  {
    id: "mock-jacket-003",
    headline: "Stone Island soft shell jacket",
    designer: "Stone Island",
    designerSlug: "stone-island",
    imageHref:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    listingHref: "https://mock.closetsearch.dev/listings/mock-jacket-003",
    amount: 195,
    currencyCode: "USD",
    department: "jackets",
    taggedSize: "XL",
    wear: "fair",
    purchaseFormat: "auction",
    indexedAt: "2026-05-01T11:15:00.000Z",
  },
  {
    id: "mock-tee-001",
    headline: "Undercover graphic tee",
    designer: "Undercover",
    designerSlug: "undercover",
    imageHref:
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80",
    listingHref: "https://mock.closetsearch.dev/listings/mock-tee-001",
    amount: 88,
    currencyCode: "USD",
    department: "tops",
    taggedSize: "M",
    wear: "good",
    purchaseFormat: "buy_now",
    indexedAt: "2026-05-04T08:05:00.000Z",
  },
];

function normalizeBrand(raw: RawMockListing): Brand {
  return {
    id: `brand:${raw.designerSlug}`,
    slug: raw.designerSlug,
    name: raw.designer,
  };
}

export function normalizeMockListing(raw: RawMockListing): Listing {
  return {
    id: `${MOCK_PROVIDER_ID}:${raw.id}`,
    providerId: MOCK_PROVIDER_ID,
    providerListingId: raw.id,
    source: {
      id: MOCK_PROVIDER_ID,
      name: MOCK_PROVIDER_NAME,
    },
    sourceUrl: raw.listingHref,
    title: raw.headline,
    brand: normalizeBrand(raw),
    imageUrl: raw.imageHref,
    price: {
      amount: raw.amount,
      currency: raw.currencyCode,
    },
    category: raw.department,
    size: raw.taggedSize,
    condition: raw.wear,
    listingType: raw.purchaseFormat,
    fetchedAt: raw.indexedAt,
  };
}

function toSearchTerms(text: string) {
  return text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesQuery(raw: RawMockListing, query: ProviderSearchQuery) {
  const terms = toSearchTerms(query.text);

  if (terms.length > 0) {
    const haystack = [
      raw.headline,
      raw.designer,
      raw.department,
      raw.taggedSize ?? "",
    ]
      .join(" ")
      .toLowerCase();

    if (!terms.every((term) => haystack.includes(term))) {
      return false;
    }
  }

  if (
    query.brandSlugs &&
    query.brandSlugs.length > 0 &&
    !query.brandSlugs.includes(raw.designerSlug)
  ) {
    return false;
  }

  if (
    query.categories &&
    query.categories.length > 0 &&
    !query.categories.includes(raw.department)
  ) {
    return false;
  }

  if (
    query.sizes &&
    query.sizes.length > 0 &&
    (!raw.taggedSize || !query.sizes.includes(raw.taggedSize))
  ) {
    return false;
  }

  if (
    query.conditions &&
    query.conditions.length > 0 &&
    !query.conditions.includes(raw.wear)
  ) {
    return false;
  }

  if (
    query.listingTypes &&
    query.listingTypes.length > 0 &&
    !query.listingTypes.includes(raw.purchaseFormat)
  ) {
    return false;
  }

  if (
    query.sourceIds &&
    query.sourceIds.length > 0 &&
    !query.sourceIds.includes(MOCK_PROVIDER_ID)
  ) {
    return false;
  }

  if (query.price?.min !== undefined && raw.amount < query.price.min) {
    return false;
  }

  if (query.price?.max !== undefined && raw.amount > query.price.max) {
    return false;
  }

  if (
    query.currency &&
    query.currency.toUpperCase() !== raw.currencyCode.toUpperCase()
  ) {
    return false;
  }

  return true;
}

function sortListings(
  listings: RawMockListing[],
  sortMode: SearchSortMode = "relevance",
) {
  const sorted = [...listings];

  switch (sortMode) {
    case "price_asc":
      sorted.sort((left, right) => left.amount - right.amount);
      break;
    case "price_desc":
      sorted.sort((left, right) => right.amount - left.amount);
      break;
    case "newest":
      sorted.sort(
        (left, right) =>
          new Date(right.indexedAt).getTime() - new Date(left.indexedAt).getTime(),
      );
      break;
    case "relevance":
    default:
      sorted.sort(
        (left, right) =>
          new Date(right.indexedAt).getTime() - new Date(left.indexedAt).getTime(),
      );
      break;
  }

  return sorted;
}

function normalizePage(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.trunc(value);
}

function normalizePageSize(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return defaultMockPageSize;
  }

  return Math.trunc(value);
}

export const mockProvider: Provider = {
  id: MOCK_PROVIDER_ID,
  name: MOCK_PROVIDER_NAME,
  capabilities: {
    supportsPagination: true,
    supportsPagePagination: true,
    supportsCursorPagination: false,
    supportsPriceRange: true,
    supportedListingTypes: ["auction", "buy_now", "unknown"],
    supportedSortModes: ["relevance", "price_asc", "price_desc", "newest"],
  },
  async search(request: ProviderSearchRequest) {
    const matchedListings = sortListings(
      rawMockListings.filter((listing) => matchesQuery(listing, request.query)),
      request.query.sort,
    ).map(normalizeMockListing);

    const page = normalizePage(request.pagination?.page);
    const pageSize = normalizePageSize(request.pagination?.pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const listings = matchedListings.slice(startIndex, endIndex);
    const hasMore = endIndex < matchedListings.length;
    const pagination = {
      page,
      pageSize,
      hasMore,
      nextPage: hasMore ? page + 1 : undefined,
      totalCount: matchedListings.length,
    };

    return {
      providerId: MOCK_PROVIDER_ID,
      status: "success",
      listings,
      pagination,
      metadata: {
        providerId: MOCK_PROVIDER_ID,
        fetchedAt: new Date().toISOString(),
        resultCount: listings.length,
        pagination,
      },
    };
  },
};
