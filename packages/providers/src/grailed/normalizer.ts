import type { Brand, Listing, ListingCondition, ListingType } from "@closetsearch/shared";
import type { RawGrailedFixtureListing } from "./fixtures";
import type { ParsedGrailedListingCard } from "./parser";

export interface GrailedListingInput {
  brandName?: string | null;
  brandSlug?: string | null;
  category?: string | null;
  condition?: string | null;
  fetchedAt?: string | null;
  id?: string | null;
  imageUrl?: string | null;
  listingType?: string | null;
  priceText?: string | null;
  size?: string | null;
  sourceListingId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
}

const GRAILED_PROVIDER_ID = "grailed";
const GRAILED_PROVIDER_NAME = "Grailed";
const grailedBaseUrl = "https://www.grailed.com";
const fallbackGrailedImageUrl = "https://closetsearch.dev/placeholders/grailed-listing.png";

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBrand(raw: GrailedListingInput): Brand {
  const rawName = toTrimmedString(raw.brandName);
  const name = rawName || "Unknown Brand";
  const slug = toTrimmedString(raw.brandSlug) || slugify(name) || "unknown-brand";

  return {
    id: "brand:" + slug,
    slug,
    name,
  };
}

function normalizeListingType(value: string | null | undefined): ListingType {
  switch (toTrimmedString(value).toLowerCase()) {
    case "auction":
      return "auction";
    case "buy_now":
    case "fixed_price":
    case "instant":
      return "buy_now";
    default:
      return "unknown";
  }
}

function normalizeCondition(value: string | null | undefined): ListingCondition | undefined {
  switch (toTrimmedString(value).toLowerCase()) {
    case "new":
    case "new_with_tags":
    case "nwt":
      return "new_with_tags";
    case "new_without_tags":
    case "nwot":
      return "new_without_tags";
    case "excellent":
      return "excellent";
    case "good":
      return "good";
    case "fair":
      return "fair";
    case "unknown":
      return "unknown";
    default:
      return undefined;
  }
}

function normalizeSourceListingId(raw: GrailedListingInput) {
  const explicitId = toTrimmedString(raw.sourceListingId) || toTrimmedString(raw.id);

  if (explicitId) {
    return explicitId;
  }

  const sourceUrl = toTrimmedString(raw.sourceUrl);

  if (sourceUrl) {
    const match = sourceUrl.match(/\/listings\/([^/?#]+)/i);

    if (match?.[1]) {
      return match[1];
    }
  }

  const titleSlug = slugify(toTrimmedString(raw.title));
  return titleSlug ? "generated-" + titleSlug : "generated-grailed-listing";
}

function normalizeSourceUrl(pathOrUrl: string | null | undefined, sourceListingId: string) {
  const value = toTrimmedString(pathOrUrl);

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const normalizedPath = value || "/listings/" + sourceListingId;
  return grailedBaseUrl + (normalizedPath.startsWith("/") ? normalizedPath : "/" + normalizedPath);
}

function normalizeMoney(value: string | null | undefined) {
  const text = toTrimmedString(value).replace(/,/g, "");
  const amountMatch = text.match(/(\d+(?:\.\d{1,2})?)/);
  const currency = text.includes("€")
    ? "EUR"
    : text.includes("£")
      ? "GBP"
      : text.toUpperCase().includes("USD") || text.includes("$")
        ? "USD"
        : "USD";
  const amount = amountMatch ? Number(amountMatch[1]) : 0;

  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
  };
}

function normalizeFetchedAt(value: string | null | undefined) {
  const timestamp = toTrimmedString(value);

  if (!timestamp) {
    return new Date().toISOString();
  }

  const parsedDate = new Date(timestamp);
  return Number.isNaN(parsedDate.valueOf()) ? new Date().toISOString() : parsedDate.toISOString();
}

export function createGrailedListingInputFromFixture(raw: RawGrailedFixtureListing): GrailedListingInput {
  return {
    id: raw.id,
    sourceListingId: raw.id,
    sourceUrl: raw.canonicalPath,
    title: raw.title,
    brandName: raw.brandName,
    brandSlug: raw.brandSlug,
    imageUrl: raw.primaryPhotoUrl,
    priceText: raw.priceText,
    category: raw.category,
    size: raw.size,
    condition: raw.condition,
    listingType: raw.listingType,
    fetchedAt: raw.publishedAt,
  };
}

export function createGrailedListingInputFromParsedCard(
  raw: ParsedGrailedListingCard,
  fetchedAt: string,
): GrailedListingInput {
  return {
    id: raw.sourceListingId,
    sourceListingId: raw.sourceListingId,
    sourceUrl: raw.sourceUrl,
    title: raw.title,
    brandName: raw.brand,
    brandSlug: raw.brand ? slugify(raw.brand) : undefined,
    imageUrl: raw.imageUrl,
    priceText: raw.priceText,
    category: raw.category,
    size: raw.size,
    condition: raw.condition,
    listingType: raw.listingType,
    fetchedAt,
  };
}

export function normalizeGrailedListing(raw: GrailedListingInput): Listing {
  const providerListingId = normalizeSourceListingId(raw);

  return {
    id: GRAILED_PROVIDER_ID + ":" + providerListingId,
    providerId: GRAILED_PROVIDER_ID,
    providerListingId,
    source: {
      id: GRAILED_PROVIDER_ID,
      name: GRAILED_PROVIDER_NAME,
    },
    sourceUrl: normalizeSourceUrl(raw.sourceUrl, providerListingId),
    title: toTrimmedString(raw.title) || "Grailed listing",
    brand: normalizeBrand(raw),
    imageUrl: toTrimmedString(raw.imageUrl) || fallbackGrailedImageUrl,
    price: normalizeMoney(raw.priceText),
    category: toTrimmedString(raw.category) || undefined,
    size: toTrimmedString(raw.size) || undefined,
    condition: normalizeCondition(raw.condition),
    listingType: normalizeListingType(raw.listingType),
    fetchedAt: normalizeFetchedAt(raw.fetchedAt),
  };
}
