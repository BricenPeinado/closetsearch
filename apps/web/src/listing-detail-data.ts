import type { Listing, Money } from "@closetsearch/shared";

export interface ListingAuctionDetails {
  bidCount?: number;
  buyNowPrice?: Money;
  currentBid?: Money;
  endedPrice?: Money;
  endsAt?: string;
}

export interface ListingLanguageDetails {
  description?: string;
  originalDescription?: string;
  originalLanguage?: string;
  originalTitle?: string;
  translatedDescription?: string;
  translatedLanguage?: string;
  translatedTitle?: string;
}

export interface ListingInternationalDetails {
  internationalShippingAvailable?: boolean;
  proxyBuyingNote?: string;
  proxyBuyingRequired?: boolean;
}

export type ListingWithContext = Listing &
  ListingLanguageDetails &
  ListingInternationalDetails & {
    auction?: ListingAuctionDetails;
  };

const cachePrefix = "closetsearch.listing-detail.v1.";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(...values: unknown[]) {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function booleanValue(...values: unknown[]) {
  return values.find((value): value is boolean => typeof value === "boolean");
}

function numberValue(...values: unknown[]) {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

function joinedString(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ")
    : undefined;
}

function moneyValue(...values: unknown[]): Money | undefined {
  for (const value of values) {
    const candidate = record(value);
    if (!candidate) {
      continue;
    }

    const currency = stringValue(candidate.currency);
    const amount = numberValue(candidate.amount);
    const amountMinor = numberValue(candidate.amountMinor);
    if (!currency || (amount === undefined && amountMinor === undefined)) {
      continue;
    }

    return {
      amount:
        amount ??
        (amountMinor as number) /
          10 **
            (numberValue(candidate.fractionDigits) ?? (currency.toUpperCase() === "JPY" ? 0 : 2)),
      amountMinor,
      currency,
      fractionDigits: numberValue(candidate.fractionDigits),
    };
  }

  return undefined;
}

export function normalizeListingContext(listing: Listing): ListingWithContext {
  const extended = listing as ListingWithContext;
  const listingRecord = record(listing) ?? {};
  const market = record(listingRecord.market);
  const auction = record(listingRecord.auction) ?? record(market?.auction);
  const translation = record(listingRecord.translation) ?? record(listingRecord.translated);
  const original = record(listingRecord.original);
  const international =
    record(listingRecord.internationalShipping) ??
    record(listingRecord.international) ??
    record(listingRecord.proxyBuying) ??
    record(listingRecord.marketplaceLimitations);

  return {
    ...extended,
    auction:
      listing.listingType === "auction" || auction
        ? {
            bidCount: numberValue(
              auction?.bidCount,
              auction?.bids,
              market?.bidCount,
              listingRecord.bidCount,
            ),
            buyNowPrice: moneyValue(
              auction?.buyNowPrice,
              auction?.buyNow,
              market?.buyNowPrice,
              listingRecord.buyNowPrice,
            ),
            currentBid: moneyValue(
              auction?.currentBid,
              market?.currentBid,
              listingRecord.currentBid,
              listing.listingType === "auction" ? listing.price : undefined,
            ),
            endedPrice: moneyValue(
              auction?.endedPrice,
              auction?.completedPrice,
              market?.completedPrice,
              listing.market?.soldPrice,
            ),
            endsAt: stringValue(
              auction?.endsAt,
              auction?.endTime,
              market?.auctionEndsAt,
              listing.lifecycle?.endedAt,
            ),
          }
        : undefined,
    description: stringValue(
      extended.description,
      listingRecord.description,
      original?.description,
    ),
    internationalShippingAvailable: booleanValue(
      extended.internationalShippingAvailable,
      international?.available,
      international?.internationalShippingAvailable,
      international?.internationalShipping === "available"
        ? true
        : international?.internationalShipping === "domestic_only" ||
            international?.internationalShipping === "proxy_only"
          ? false
          : undefined,
      listing.shipping?.available,
    ),
    originalDescription: stringValue(
      extended.originalDescription,
      original?.description,
      listingRecord.originalDescription,
    ),
    originalLanguage: stringValue(
      extended.originalLanguage,
      original?.language,
      listingRecord.originalLanguage,
      listingRecord.language,
    ),
    originalTitle: stringValue(
      extended.originalTitle,
      original?.title,
      listingRecord.originalTitle,
    ),
    proxyBuyingNote: stringValue(
      extended.proxyBuyingNote,
      international?.note,
      international?.disclaimer,
      joinedString(international?.notices),
      listingRecord.proxyBuyingNote,
    ),
    proxyBuyingRequired: booleanValue(
      extended.proxyBuyingRequired,
      international?.proxyRequired,
      international?.required,
      international?.proxyPurchaseRequired,
      listingRecord.proxyBuyingRequired,
    ),
    translatedDescription: stringValue(
      extended.translatedDescription,
      translation?.description,
      listingRecord.translatedDescription,
    ),
    translatedLanguage: stringValue(
      extended.translatedLanguage,
      translation?.language,
      listingRecord.translatedLanguage,
    ),
    translatedTitle: stringValue(
      extended.translatedTitle,
      translation?.title,
      listingRecord.translatedTitle,
    ),
  };
}

export function normalizeListingDetailPayload(value: unknown) {
  const payload = record(value);
  const candidate = (record(payload?.listing) ?? payload) as unknown as Listing | undefined;
  if (
    !candidate ||
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.sourceUrl !== "string" ||
    !candidate.source ||
    !candidate.brand ||
    !candidate.price
  ) {
    return undefined;
  }

  return normalizeListingContext(candidate);
}

export function rememberListingForDetail(listing: Listing) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      `${cachePrefix}${listing.id}`,
      JSON.stringify(normalizeListingContext(listing)),
    );
  } catch {
    // Detail navigation still works through router state when storage is unavailable.
  }
}

export function loadRememberedListing(listingId: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(`${cachePrefix}${listingId}`);
    return raw ? normalizeListingDetailPayload(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}
