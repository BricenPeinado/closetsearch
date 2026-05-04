import type { Listing } from "@closetsearch/shared";

function formatPrice(listing: Listing) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.price.currency,
    maximumFractionDigits: 0,
  }).format(listing.price.amount);
}

export function ListingCard({ listing }: { listing: Listing }) {
  const metadata = [listing.category, listing.size, listing.condition]
    .filter(Boolean)
    .join(" • ");

  return (
    <a
      className="listing-card"
      href={listing.sourceUrl}
      rel="noreferrer"
      target="_blank"
    >
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
          <span>Open source</span>
        </div>
      </div>
    </a>
  );
}
