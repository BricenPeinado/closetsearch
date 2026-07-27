import { useEffect, useMemo, useState } from "react";
import type { Listing } from "@closetsearch/shared";
import { Link, useLocation, useParams } from "react-router-dom";
import { ApiClientError, fetchJson } from "../api-client";
import { isListingEngagementEligible, recordEngagementEvent } from "../engagement-client";
import {
  loadRememberedListing,
  normalizeListingContext,
  normalizeListingDetailPayload,
  rememberListingForDetail,
  type ListingWithContext,
} from "../listing-detail-data";
import {
  containsJapaneseText,
  formatDateTime,
  formatLanguageName,
  formatMoney,
  formatRelativeEndTime,
  getPreferredLocale,
  getPreferredTimeZone,
} from "../product-formatting";
import { PriceTrendPanel } from "./price-trend-panel";

const fallbackImageUrl = "/listing-placeholder.svg";

function safeDecodeListingId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function routeListing(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return normalizeListingDetailPayload((value as { listing?: unknown }).listing);
}

function isJapaneseMarketplace(listing: Listing) {
  const identifiers = [
    listing.providerId,
    listing.source.id,
    listing.source.marketplaceId,
    listing.source.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    identifiers.includes("yahoo") ||
    identifiers.includes("mercari-jp") ||
    identifiers.includes("mercari japan")
  );
}

function MetadataItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="listing-detail__metadata-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PricingItem({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <article className="listing-detail__price-item">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function ListingGallery({ listing }: { listing: ListingWithContext }) {
  const images = useMemo(() => {
    const candidates = [
      ...(listing.images ?? []),
      ...(listing.imageUrl
        ? [{ alt: listing.title, role: "primary" as const, url: listing.imageUrl }]
        : []),
    ];
    return Array.from(
      new Map(
        candidates
          .filter((image) => typeof image.url === "string" && image.url.trim().length > 0)
          .map((image) => [image.url, image]),
      ).values(),
    );
  }, [listing.imageUrl, listing.images, listing.title]);
  const [selectedImage, setSelectedImage] = useState(images[0]?.url ?? fallbackImageUrl);

  useEffect(() => {
    setSelectedImage(images[0]?.url ?? fallbackImageUrl);
  }, [images]);

  return (
    <section aria-label="Listing images" className="listing-gallery">
      <div className="listing-gallery__hero">
        <img
          alt={listing.title}
          className="listing-gallery__hero-image"
          decoding="async"
          onError={() => setSelectedImage(fallbackImageUrl)}
          src={selectedImage}
        />
      </div>
      {images.length > 1 ? (
        <div aria-label="Choose listing image" className="listing-gallery__thumbnails" role="group">
          {images.map((image, index) => (
            <button
              aria-label={`Show image ${index + 1} of ${images.length}`}
              aria-pressed={selectedImage === image.url}
              className={
                selectedImage === image.url
                  ? "listing-gallery__thumbnail listing-gallery__thumbnail--active"
                  : "listing-gallery__thumbnail"
              }
              key={image.url}
              onClick={() => setSelectedImage(image.url)}
              type="button"
            >
              <img
                alt={image.alt?.trim() || ""}
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.src = fallbackImageUrl;
                }}
                src={image.url}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ListingDetail({
  listing,
  locale,
  timeZone,
}: {
  listing: ListingWithContext;
  locale: string;
  timeZone: string;
}) {
  const originalTitle = listing.originalTitle ?? listing.title;
  const translatedTitle =
    listing.translatedTitle && listing.translatedTitle !== originalTitle
      ? listing.translatedTitle
      : undefined;
  const titleIsJapanese =
    containsJapaneseText(originalTitle) || listing.originalLanguage?.toLowerCase().startsWith("ja");
  const displayTitle = translatedTitle ?? listing.title;
  const originalDescription = listing.originalDescription ?? listing.description;
  const translatedDescription =
    listing.translatedDescription && listing.translatedDescription !== originalDescription
      ? listing.translatedDescription
      : undefined;
  const pricing = listing.pricing;
  const originalPrice = pricing?.original ?? listing.price;
  const displayPrice = pricing?.display;
  const shippingPrice = pricing?.shipping ?? listing.shipping?.cost;
  const landedPrice = pricing?.landed;
  const auction = listing.auction;
  const status = listing.lifecycle?.status ?? listing.market?.status ?? "unknown";
  const sellerName = listing.seller?.displayName ?? listing.seller?.username;
  const japaneseMarketplace = isJapaneseMarketplace(listing);
  const proxyNote =
    listing.proxyBuyingNote ??
    (japaneseMarketplace
      ? "This marketplace may require a third-party proxy and domestic Japanese delivery. ClosetSearch is not the seller, purchasing agent, or shipping provider."
      : undefined);
  const externalLabel =
    listing.attribution?.displayText?.trim() || `Continue to ${listing.source.name}`;
  const externalUrl = listing.attribution?.destinationUrl || listing.sourceUrl;

  function recordOutboundOpen() {
    if (!isListingEngagementEligible(listing)) {
      return;
    }

    void recordEngagementEvent({
      eventType: "conversion",
      listingId: listing.id,
      properties: {
        providerId: listing.providerId,
        surface: "listing_detail",
      },
    });
  }

  return (
    <article className="listing-detail">
      <div className="listing-detail__breadcrumbs">
        <Link to="/search">Search</Link>
        <span aria-hidden="true">/</span>
        <span>{listing.brand.name || listing.source.name}</span>
      </div>

      <div className="listing-detail__layout">
        <ListingGallery listing={listing} />

        <div className="listing-detail__summary">
          <div className="listing-detail__edition-line">
            <span>ClosetSearch market view</span>
            <span>Observed listing / {listing.providerId}</span>
          </div>
          <div className="chip-row">
            <span className="info-chip info-chip--accent">{listing.source.name}</span>
            <span className="info-chip">
              {listing.listingType === "auction" ? "Auction" : "Buy now"}
            </span>
            <span className={`info-chip listing-detail__status listing-detail__status--${status}`}>
              {status}
            </span>
          </div>

          <div className="listing-detail__title-group">
            <p className="eyebrow">{listing.brand.name || "Unknown brand"}</p>
            <h1>{displayTitle}</h1>
            {translatedTitle || titleIsJapanese ? (
              <div className="original-language-copy" lang={titleIsJapanese ? "ja" : undefined}>
                <span>
                  {titleIsJapanese
                    ? "Original Japanese title"
                    : `Original ${formatLanguageName(listing.originalLanguage, locale) ?? "language"} title`}
                </span>
                <p>{originalTitle}</p>
              </div>
            ) : null}
            {translatedTitle ? (
              <p className="translation-note">
                Translated display text ·{" "}
                {formatLanguageName(listing.translatedLanguage ?? "en", locale) ?? "English"}
              </p>
            ) : null}
          </div>

          <div className="listing-detail__pricing">
            <PricingItem label="Original price" value={formatMoney(originalPrice, locale)} />
            {displayPrice ? (
              <PricingItem
                label="Converted display price"
                note={`Rate ${displayPrice.exchangeRate} from ${displayPrice.exchangeRateSource} · ${formatDateTime(displayPrice.exchangeRateTimestamp, { locale, timeZone })}`}
                value={formatMoney(displayPrice, locale)}
              />
            ) : (
              <PricingItem
                label="Converted display price"
                note="No sourced exchange rate is available."
                value="Not available"
              />
            )}
            <PricingItem
              label="Shipping"
              note={
                listing.shipping?.isFree
                  ? "Marketplace reports free shipping."
                  : listing.shipping?.type
              }
              value={
                listing.shipping?.isFree
                  ? "Free"
                  : shippingPrice
                    ? formatMoney(shippingPrice, locale)
                    : "Not supplied"
              }
            />
            <PricingItem
              label="Estimated landed price"
              note="Includes only sourced price components; duties and proxy fees may be excluded."
              value={landedPrice ? formatMoney(landedPrice, locale) : "Not available"}
            />
          </div>

          {listing.listingType === "auction" ? (
            <section aria-labelledby="auction-state-heading" className="auction-state">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Auction state</p>
                  <h2 id="auction-state-heading">
                    {status === "sold" ? "Completed auction" : "Live auction"}
                  </h2>
                </div>
              </div>
              <div className="auction-state__grid">
                <PricingItem
                  label={status === "sold" ? "Completed price" : "Current bid"}
                  note={
                    status === "sold"
                      ? "Shown as completed only when the marketplace confirms the outcome."
                      : "An unfinished bid is not a completed sale price."
                  }
                  value={
                    status === "sold" && auction?.endedPrice
                      ? formatMoney(auction.endedPrice, locale)
                      : auction?.currentBid
                        ? formatMoney(auction.currentBid, locale)
                        : "Not supplied"
                  }
                />
                <PricingItem
                  label="Buy-now price"
                  value={
                    auction?.buyNowPrice ? formatMoney(auction.buyNowPrice, locale) : "Not offered"
                  }
                />
                <PricingItem
                  label="Bid count"
                  value={
                    auction?.bidCount !== undefined ? String(auction.bidCount) : "Not supplied"
                  }
                />
                <PricingItem
                  label={status === "sold" ? "Ended" : "Ends"}
                  value={
                    auction?.endsAt
                      ? formatRelativeEndTime(auction.endsAt, { locale, timeZone })
                      : "Not supplied"
                  }
                />
              </div>
            </section>
          ) : null}

          <dl className="listing-detail__metadata">
            <MetadataItem label="Condition" value={listing.condition ?? "Not supplied"} />
            <MetadataItem label="Size" value={listing.size ?? "Not supplied"} />
            <MetadataItem label="Category" value={listing.category ?? "Not supplied"} />
            <MetadataItem
              label="Freshness"
              value={
                listing.freshness?.observedAt || listing.lifecycle?.observedAt
                  ? `${listing.freshness?.status ?? "observed"} · ${formatDateTime(
                      listing.freshness?.observedAt ??
                        listing.lifecycle?.observedAt ??
                        listing.fetchedAt,
                      { locale, timeZone },
                    )}`
                  : formatDateTime(listing.fetchedAt, { locale, timeZone })
              }
            />
          </dl>

          {sellerName ? (
            <section className="listing-detail__seller">
              <p className="eyebrow">Marketplace seller</p>
              <h2>{sellerName}</h2>
              <p>
                {listing.seller?.feedbackPercentage !== undefined
                  ? `${listing.seller.feedbackPercentage}% positive feedback`
                  : listing.seller?.feedbackCount !== undefined
                    ? `${listing.seller.feedbackCount} marketplace feedback entries`
                    : "Seller details are supplied by the marketplace."}
              </p>
            </section>
          ) : null}

          <div className="listing-detail__handoff">
            <a
              className="external-cta"
              href={externalUrl}
              onClick={recordOutboundOpen}
              rel={listing.attribution?.affiliate ? "noreferrer sponsored" : "noreferrer"}
              target="_blank"
            >
              {externalLabel} <span aria-hidden="true">↗</span>
            </a>
            <p>
              You are leaving ClosetSearch. Confirm availability, total cost, seller terms, and
              marketplace protections before purchasing.
            </p>
          </div>
        </div>
      </div>

      {translatedDescription || originalDescription ? (
        <section aria-labelledby="listing-description-heading" className="listing-description">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Marketplace copy</p>
              <h2 id="listing-description-heading">Description</h2>
            </div>
          </div>
          {translatedDescription ? (
            <div>
              <span className="translation-note">Translated description</span>
              <p>{translatedDescription}</p>
            </div>
          ) : null}
          {originalDescription ? (
            <details open={!translatedDescription}>
              <summary>
                {translatedDescription ? "Show original description" : "Original description"}
              </summary>
              <p lang={containsJapaneseText(originalDescription) ? "ja" : undefined}>
                {originalDescription}
              </p>
            </details>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="shipping-limitations-heading" className="shipping-limitations">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Delivery context</p>
            <h2 id="shipping-limitations-heading">Shipping and marketplace limitations</h2>
          </div>
        </div>
        <div className="shipping-limitations__grid">
          <article>
            <h3>Marketplace shipping</h3>
            <p>
              {listing.shipping?.available === false
                ? "The marketplace does not report shipping as available to your destination."
                : listing.shipping?.originCountry || listing.shipping?.destinationCountry
                  ? `Reported route: ${listing.shipping.originCountry ?? "origin not supplied"} to ${listing.shipping.destinationCountry ?? "destination not supplied"}.`
                  : "Origin, destination, duties, and delivery timing are not fully supplied."}
            </p>
          </article>
          <article>
            <h3>{japaneseMarketplace ? "Japan-market handoff" : "International purchase"}</h3>
            <p>
              {proxyNote ??
                "International delivery and import fees depend on the marketplace and seller. ClosetSearch does not purchase or ship the item."}
            </p>
          </article>
        </div>
      </section>

      <PriceTrendPanel listingId={listing.id} locale={locale} timeZone={timeZone} />
    </article>
  );
}

export function ListingDetailRoutePage() {
  const location = useLocation();
  const { listingId = "" } = useParams();
  const decodedListingId = safeDecodeListingId(listingId);
  const locale = getPreferredLocale();
  const timeZone = getPreferredTimeZone();
  const [state, setState] = useState<{
    errorMessage?: string;
    listing?: ListingWithContext;
    status: "loading" | "success" | "error";
  }>({ status: "loading" });

  useEffect(() => {
    const immediate = routeListing(location.state) ?? loadRememberedListing(decodedListingId);

    if (immediate?.id === decodedListingId) {
      const normalized = normalizeListingContext(immediate);
      rememberListingForDetail(normalized);
      setState({ listing: normalized, status: "success" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchJson<unknown>(`/listings/${encodeURIComponent(decodedListingId)}`, controller.signal)
      .then((response) => {
        const listing = normalizeListingDetailPayload(response);
        if (!listing || listing.id !== decodedListingId) {
          throw new Error("The listing response was incomplete.");
        }
        rememberListingForDetail(listing);
        setState({ listing, status: "success" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const unavailable =
          error instanceof ApiClientError &&
          (error.status === 404 || error.code === "listing_not_found");
        setState({
          errorMessage: unavailable
            ? "This listing is no longer available in ClosetSearch’s normalized catalog."
            : error instanceof Error
              ? error.message
              : "The listing could not be loaded.",
          status: "error",
        });
      });

    return () => controller.abort();
  }, [decodedListingId, location.state]);

  if (state.status === "loading") {
    return (
      <section aria-live="polite" className="page-shell listing-detail-loading" role="status">
        <span className="skeleton-line skeleton-line--short" />
        <span className="skeleton-line" />
        <span className="skeleton-line skeleton-line--price" />
        Loading listing context…
      </section>
    );
  }

  if (state.status === "error" || !state.listing) {
    return (
      <section className="page-shell">
        <div className="state-card">
          <h1>Listing unavailable</h1>
          <p>{state.errorMessage ?? "The listing could not be loaded."}</p>
          <div className="state-card__action">
            <Link className="secondary-button link-button" to="/search">
              Return to search
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return <ListingDetail listing={state.listing} locale={locale} timeZone={timeZone} />;
}
