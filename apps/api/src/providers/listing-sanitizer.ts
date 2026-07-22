import type { Brand, Listing, Money } from "@closetsearch/shared";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidListingType(value: unknown): value is Listing["listingType"] {
  return value === "auction" || value === "buy_now" || value === "unknown";
}

function isValidBrand(brand: unknown): brand is Brand {
  return Boolean(
    brand &&
      typeof brand === "object" &&
      isNonEmptyString((brand as Brand).id) &&
      isNonEmptyString((brand as Brand).slug) &&
      isNonEmptyString((brand as Brand).name),
  );
}

function isValidMoney(price: unknown): price is Money {
  return Boolean(
    price &&
      typeof price === "object" &&
      typeof (price as Money).amount === "number" &&
      Number.isFinite((price as Money).amount) &&
      isNonEmptyString((price as Money).currency),
  );
}

function sanitizeBrand(brand: Brand): Brand {
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    aliases: brand.aliases ? [...brand.aliases] : undefined,
    tags: brand.tags ? [...brand.tags] : undefined,
  };
}

function sanitizeMoney(price: Money): Money {
  return {
    amount: price.amount,
    currency: price.currency,
  };
}

function isValidProviderListing(listing: unknown): listing is Listing {
  return Boolean(
    listing &&
      typeof listing === "object" &&
      isNonEmptyString((listing as Listing).id) &&
      isNonEmptyString((listing as Listing).providerId) &&
      isNonEmptyString((listing as Listing).providerListingId) &&
      (listing as Listing).source &&
      typeof (listing as Listing).source === "object" &&
      isNonEmptyString((listing as Listing).source.id) &&
      isNonEmptyString((listing as Listing).source.name) &&
      isNonEmptyString((listing as Listing).sourceUrl) &&
      isNonEmptyString((listing as Listing).title) &&
      isValidBrand((listing as Listing).brand) &&
      isNonEmptyString((listing as Listing).imageUrl) &&
      isValidMoney((listing as Listing).price) &&
      isValidListingType((listing as Listing).listingType) &&
      isNonEmptyString((listing as Listing).fetchedAt),
  );
}

export function sanitizeProviderListing(listing: unknown): Listing | null {
  if (!isValidProviderListing(listing)) {
    return null;
  }

  return {
    id: listing.id,
    providerId: listing.providerId,
    source: {
      id: listing.source.id,
      name: listing.source.name,
    },
    providerListingId: listing.providerListingId,
    sourceUrl: listing.sourceUrl,
    title: listing.title,
    brand: sanitizeBrand(listing.brand),
    imageUrl: listing.imageUrl,
    price: sanitizeMoney(listing.price),
    category: listing.category,
    size: listing.size,
    condition: listing.condition,
    listingType: listing.listingType,
    fetchedAt: listing.fetchedAt,
  };
}
