import { useState } from "react";
import type { Listing } from "@closetsearch/shared";

function formatPrice(listing: Listing) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.price.currency,
    maximumFractionDigits: 0,
  }).format(listing.price.amount);
}

function formatListingType(listing: Listing) {
  if (listing.listingType === "auction") {
    return "Auction";
  }

  if (listing.listingType === "buy_now") {
    return "Fixed price";
  }

  return "Listing";
}

interface ListingCardProps {
  listing: Listing;
  isLiked?: boolean;
  onToggleLike?: (listing: Listing, nextLiked: boolean) => Promise<void>;
}

export function ListingCard({
  listing,
  isLiked = false,
  onToggleLike,
}: ListingCardProps) {
  const metadata = [listing.category, listing.size, listing.condition]
    .filter(Boolean)
    .join(" • ");
  const [isSubmittingLike, setIsSubmittingLike] = useState(false);

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

  return (
    <article className="listing-card">
      <button
        aria-label={isLiked ? "Remove from likes" : "Save to likes"}
        className={isLiked ? "heart-button heart-button--active" : "heart-button"}
        disabled={!onToggleLike || isSubmittingLike}
        onClick={handleToggleLike}
        type="button"
      >
        {isLiked ? "♥" : "♡"}
      </button>

      <a href={listing.sourceUrl} rel="noreferrer" target="_blank">
        <div className="listing-card__image-wrap">
          <img
            alt={listing.title}
            className="listing-card__image"
            loading="lazy"
            src={listing.imageUrl}
          />
        </div>
        <div className="listing-card__body">
          <div className="listing-card__topline">
            <p>{listing.brand.name}</p>
            <span>{listing.source.name}</span>
          </div>
          <h2>{listing.title}</h2>
          <p className="listing-card__meta">{metadata || "Normalized listing"}</p>
          <div className="listing-card__footer">
            <strong>{formatPrice(listing)}</strong>
            <span>{formatListingType(listing)}</span>
          </div>
        </div>
      </a>
    </article>
  );
}
