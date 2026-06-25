import type { Brand, Listing, Money } from "@closetsearch/shared";

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

export function sanitizeProviderListing(listing: Listing): Listing {
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
