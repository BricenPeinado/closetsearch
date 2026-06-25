export interface RawGrailedFixtureListing {
  id: string;
  title: string;
  canonicalPath: string;
  brandName?: string | null;
  brandSlug?: string | null;
  primaryPhotoUrl?: string | null;
  priceText?: string | null;
  category?: string | null;
  size?: string | null;
  condition?: string | null;
  listingType?: string | null;
  publishedAt?: string | null;
}

export const grailedFixtureListings: RawGrailedFixtureListing[] = [
  {
    id: "grailed-1001-kapital-ring-coat",
    title: "Kapital ring coat",
    canonicalPath: "/listings/grailed-1001-kapital-ring-coat",
    brandName: "Kapital",
    brandSlug: "kapital",
    primaryPhotoUrl: "https://media.example.com/grailed-1001.jpg",
    priceText: "$325",
    category: "outerwear",
    size: "L",
    condition: "good",
    listingType: "buy_now",
    publishedAt: "2026-06-13T11:00:00.000Z",
  },
  {
    id: "grailed-1002-vintage-band-tee",
    title: "Vintage band tee",
    canonicalPath: "/listings/grailed-1002-vintage-band-tee",
    brandName: null,
    brandSlug: null,
    primaryPhotoUrl: null,
    priceText: "$85",
    category: "tops",
    size: null,
    condition: null,
    listingType: null,
    publishedAt: null,
  },
];

export const grailedSearchHtmlFixture = [
  '<section data-testid="search-results">',
  '  <article data-testid="listing-tile" data-listing-id="grailed-1001-kapital-ring-coat">',
  '    <a href="/listings/grailed-1001-kapital-ring-coat" aria-label="Kapital ring coat">',
  '      <img src="https://media.example.com/grailed-1001.jpg" alt="Kapital ring coat" />',
  '      <div data-testid="listing-brand">Kapital</div>',
  '      <div data-testid="listing-title">Kapital ring coat</div>',
  '      <div data-testid="listing-price">$325</div>',
  '      <div data-testid="listing-size">L</div>',
  '      <div data-testid="listing-condition">Good</div>',
  '      <div data-testid="listing-category">Outerwear</div>',
  '    </a>',
  '  </article>',
  '  <article data-testid="listing-tile" data-listing-id="grailed-1002-vintage-band-tee">',
  '    <a href="/listings/grailed-1002-vintage-band-tee" aria-label="Vintage band tee">',
  '      <img src="https://media.example.com/grailed-1002.jpg" alt="Vintage band tee" />',
  '      <div data-testid="listing-brand">Vintage</div>',
  '      <div data-testid="listing-title">Vintage band tee</div>',
  '      <div data-testid="listing-price">US $85</div>',
  '      <div data-testid="listing-size">M</div>',
  '      <div data-testid="listing-condition">Excellent</div>',
  '      <div data-testid="listing-category">Tops</div>',
  '    </a>',
  '  </article>',
  '</section>',
].join("\n");

export const grailedPartialSearchHtmlFixture = [
  '<section data-testid="search-results">',
  '  <article data-testid="listing-tile">',
  '    <a href="/listings/grailed-2001-unknown-archive-piece" aria-label="Unknown archive piece">',
  '      <div data-testid="listing-title">Unknown archive piece</div>',
  '      <div data-testid="listing-price">Offer</div>',
  '    </a>',
  '  </article>',
  '</section>',
].join("\n");

export const grailedNoResultsHtmlFixture = [
  '<section data-testid="search-results">',
  '  <div data-testid="empty-state">No listings found</div>',
  '</section>',
].join("\n");
