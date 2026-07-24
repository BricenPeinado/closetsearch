import { useEffect, useRef, useState } from "react";
import type { Listing, Money } from "@closetsearch/shared";
import {
  isListingEngagementEligible,
  recordEngagementEvent,
  sessionViewDeduplicator,
} from "../engagement-client";
import { observeContinuousListingView } from "../listing-view-observer";

const fallbackImageUrl = "/listing-placeholder.svg";

function formatMoney(money: Money) {
  const amount =
    typeof money.amountMinor === "number" && Number.isInteger(money.amountMinor)
      ? money.amountMinor / 10 ** (money.fractionDigits ?? 2)
      : money.amount;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: money.fractionDigits ?? 2,
  }).format(amount);
}

function formatListingType(listing: Listing) {
  if (listing.listingType === "auction") {
    return "Auction";
  }

  if (listing.listingType === "buy_now") {
    return "Buy Now";
  }

  return "Listing";
}

interface ListingCardProps {
  engagement?: ListingCardEngagementContext;
  listing: Listing;
  isLiked?: boolean;
  onToggleLike?: (listing: Listing, nextLiked: boolean) => Promise<void>;
}

export interface ListingCardEngagementContext {
  rankedPosition?: number;
  recommendationRequestId?: string;
  surface: "home_feed" | "liked_items" | "search_results";
  viewContextId: string;
}

export function ListingCard({
  engagement,
  listing,
  isLiked = false,
  onToggleLike,
}: ListingCardProps) {
  const cardReference = useRef<HTMLElement>(null);
  const metadata = [listing.category, listing.size, listing.condition].filter(Boolean).join(" • ");
  const [isSubmittingLike, setIsSubmittingLike] = useState(false);
  const [imageSource, setImageSource] = useState(listing.imageUrl || fallbackImageUrl);
  const riskSignal =
    import.meta.env.VITE_EXPERIMENTAL_METADATA_SIGNALS === "true" ? listing.riskSignal : undefined;
  const hasListingTypeBadge = listing.listingType !== "unknown";
  const originalPrice = listing.pricing?.original ?? listing.price;
  const displayPrice = listing.pricing?.display;
  const convertedPrice =
    displayPrice &&
    (displayPrice.currency !== originalPrice.currency ||
      displayPrice.amountMinor !== originalPrice.amountMinor);
  const status = listing.lifecycle?.status ?? listing.market?.status ?? "unknown";
  const marketplaceName = listing.source.name || "Unknown marketplace";
  const brandName = listing.brand.name.trim() || "Unknown brand";
  const sellerName = listing.seller?.displayName ?? listing.seller?.username;
  const isMock = listing.source.isMock || listing.source.dataOrigin === "mock";

  useEffect(() => {
    const element = cardReference.current;

    if (!element || !engagement || !isListingEngagementEligible(listing)) {
      return;
    }

    return observeContinuousListingView({
      element,
      onQualifiedView: (viewportDurationMs) => {
        if (!sessionViewDeduplicator.claim(engagement.viewContextId, listing.id)) {
          return;
        }

        const properties = {
          providerId: listing.providerId,
          surface: engagement.surface,
        } as const;

        void recordEngagementEvent({
          eventType: "listing_view",
          listingId: listing.id,
          properties,
          rankedPosition: engagement.rankedPosition,
          viewportDurationMs,
        });

        if (engagement.recommendationRequestId && engagement.rankedPosition !== undefined) {
          void recordEngagementEvent({
            eventType: "recommendation_impression",
            listingId: listing.id,
            properties,
            rankedPosition: engagement.rankedPosition,
            requestId: engagement.recommendationRequestId,
          });
        }
      },
    });
  }, [
    engagement?.rankedPosition,
    engagement?.recommendationRequestId,
    engagement?.surface,
    engagement?.viewContextId,
    listing.analyticsEligibility?.eligible,
    listing.id,
    listing.providerId,
    listing.source.dataOrigin,
    listing.source.isMock,
  ]);

  async function handleToggleLike() {
    if (!onToggleLike || isSubmittingLike) {
      return;
    }

    setIsSubmittingLike(true);

    try {
      await onToggleLike(listing, !isLiked);
    } finally {
      setIsSubmittingLike(false);
    }
  }

  function handleListingOpen() {
    if (!engagement || !isListingEngagementEligible(listing)) {
      return;
    }

    void recordEngagementEvent({
      eventType: "listing_open",
      listingId: listing.id,
      properties: {
        providerId: listing.providerId,
        surface: engagement.surface,
      },
      rankedPosition: engagement.rankedPosition,
      requestId: engagement.recommendationRequestId,
    });
  }

  return (
    <article
      className={isLiked ? "listing-card listing-card--liked" : "listing-card"}
      ref={cardReference}
    >
      <button
        aria-label={isLiked ? "Remove from likes" : "Save to likes"}
        aria-pressed={isLiked}
        className={[
          "heart-button",
          isLiked ? "heart-button--active" : "",
          isSubmittingLike ? "heart-button--pending" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={!onToggleLike || isSubmittingLike}
        onClick={handleToggleLike}
        type="button"
      >
        <span aria-hidden="true">{isLiked ? "♥" : "♡"}</span>
        <span className="heart-button__label">
          {isSubmittingLike ? "Saving" : isLiked ? "Saved" : "Save"}
        </span>
      </button>

      <a
        className="listing-card__link"
        href={listing.sourceUrl}
        onClick={handleListingOpen}
        rel="noreferrer"
        target="_blank"
      >
        <div className="listing-card__image-wrap">
          {hasListingTypeBadge ? (
            <span className="listing-card__type-badge">{formatListingType(listing)}</span>
          ) : null}
          <img
            alt={listing.title}
            className="listing-card__image"
            decoding="async"
            loading="lazy"
            onError={() => setImageSource(fallbackImageUrl)}
            src={imageSource}
          />
          {status !== "unknown" ? (
            <span className={`listing-card__status listing-card__status--${status}`}>{status}</span>
          ) : null}
        </div>
        <div className="listing-card__body">
          <div className="listing-card__topline">
            <p>{brandName}</p>
            <span>{isMock ? "Mock fixture" : marketplaceName}</span>
          </div>
          <h2>{listing.title}</h2>
          <p className="listing-card__meta">{metadata || "Curated resale listing"}</p>
          {sellerName ? <p className="listing-card__seller">Seller: {sellerName}</p> : null}
          <div className="listing-card__footer">
            <div className="listing-card__prices">
              <strong>{formatMoney(displayPrice ?? originalPrice)}</strong>
              {convertedPrice ? <span>Originally {formatMoney(originalPrice)}</span> : null}
              {listing.pricing?.shipping ? (
                <span>Shipping {formatMoney(listing.pricing.shipping)}</span>
              ) : null}
            </div>
            <span className="listing-card__marketplace-action">
              View on {marketplaceName} <span aria-hidden="true">↗</span>
            </span>
          </div>
        </div>
      </a>
      {riskSignal ? (
        <details className="listing-risk">
          <summary className="listing-risk__summary">
            <span className="listing-risk__badge">Experimental metadata quality</span>
            <span className="listing-risk__hint">Not authenticity analysis</span>
          </summary>
          <div className="listing-risk__panel">
            <p>{riskSignal.explanation}</p>
            <p className="listing-risk__disclaimer">{riskSignal.disclaimer}</p>
          </div>
        </details>
      ) : null}
    </article>
  );
}
