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

export const grailedPublicConfigHtmlFixture = [
  "<html>",
  "  <head></head>",
  "  <body>",
  "    <script>",
  '      window.PUBLIC_CONFIG = {"algolia":{"appId":"GRAILED123","apiKey":"grailed-key-123"},"other":{"flag":true}};',
  "    </script>",
  "  </body>",
  "</html>",
].join("\n");

export const grailedBrokenPublicConfigHtmlFixture = [
  "<html>",
  "  <body>",
  "    <script>",
  '      window.PUBLIC_CONFIG = {"featureFlags":{"algolia":false}};',
  "    </script>",
  "  </body>",
  "</html>",
].join("\n");

export const grailedAlternateInlineConfigHtmlFixture = [
  "<html>",
  "  <head></head>",
  "  <body>",
  "    <script>",
  '      window.__PRELOADED_STATE__ = {"runtime":{"services":{"search":{"algolia":{"applicationId":"GRAILED234","apiKey":"grailed-key-234"}}}}};',
  "    </script>",
  "  </body>",
  "</html>",
].join("\n");

export const grailedHomepageScriptHtmlFixture = [
  "<html>",
  "  <head>",
  '    <script src="/assets/runtime.js"></script>',
  '    <script src="/assets/listings.js"></script>',
  "  </head>",
  "  <body>",
  '    <div id="app"></div>',
  "  </body>",
  "</html>",
].join("\n");

export const grailedNoCredentialHtmlFixture = [
  "<html>",
  "  <head>",
  '    <script src="/assets/runtime.js"></script>',
  "  </head>",
  "  <body>",
  '    <div id="app"></div>',
  "  </body>",
  "</html>",
].join("\n");

export const grailedCredentialBundleFixture = [
  "window.__APP_DATA__={};",
  'var listingSearch={indexName:"Listing_production",applicationID:"GRAILED456",apiKey:"grailed-key-456"};',
  'var soldListingSearch={indexName:"Listing_sold_production"};',
].join("\n");

export const grailedAlgoliaActiveResponseFixture = {
  hits: [
    {
      objectID: "grailed-1001-kapital-ring-coat",
      title: "Kapital ring coat",
      url: "/listings/grailed-1001-kapital-ring-coat",
      brand_name: "Kapital",
      brand_slug: "kapital",
      image_url: "https://media.example.com/grailed-1001.jpg",
      price_in_cents: 32500,
      currency: "USD",
      category: "outerwear",
      size: "L",
      condition: "good",
      listing_type: "buy_now",
      price_drops_count: 2,
      tags: ["archive", "japanese"],
      seller: {
        username: "trusted-seller",
        feedback_score: 4.9,
        feedback_count: 38,
      },
      updated_at: "2026-06-13T11:00:00.000Z",
    },
    {
      objectID: "grailed-1002-undercover-hoodie",
      title: "Undercover hoodie",
      url: "/listings/grailed-1002-undercover-hoodie",
      brand_name: "Undercover",
      brand_slug: "undercover",
      image_url: "https://media.example.com/grailed-1002.jpg",
      price_in_cents: 18000,
      currency: "USD",
      category: "tops",
      size: "M",
      condition: "fair",
      listing_type: "buy_now",
      price_drops_count: 0,
      tags: ["streetwear"],
      seller: {
        username: "low-feedback-seller",
        feedback_score: 2.5,
        feedback_count: 1,
      },
      updated_at: "2026-06-13T10:00:00.000Z",
    },
  ],
  hitsPerPage: 100,
  nbHits: 2,
  nbPages: 1,
  page: 0,
} as const;

export const grailedAlgoliaSoldResponseFixture = {
  hits: [
    {
      objectID: "grailed-sold-1001-kapital-ring-coat",
      title: "Kapital ring coat",
      url: "/listings/grailed-sold-1001-kapital-ring-coat",
      brand_name: "Kapital",
      brand_slug: "kapital",
      image_url: "https://media.example.com/grailed-sold-1001.jpg",
      price_in_cents: 32500,
      sold_price_in_cents: 29500,
      currency: "USD",
      category: "outerwear",
      size: "L",
      condition: "good",
      listing_type: "buy_now",
      price_drops_count: 1,
      metadata_tags: ["sold", "comp"],
      seller: {
        username: "archivist",
        feedback_score: 4.7,
        feedback_count: 12,
      },
      created_at: "2026-05-01T11:00:00.000Z",
    },
  ],
  hitsPerPage: 100,
  nbHits: 1,
  nbPages: 1,
  page: 0,
} as const;

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
  "    </a>",
  "  </article>",
  '  <article data-testid="listing-tile" data-listing-id="grailed-1002-vintage-band-tee">',
  '    <a href="/listings/grailed-1002-vintage-band-tee" aria-label="Vintage band tee">',
  '      <img src="https://media.example.com/grailed-1002.jpg" alt="Vintage band tee" />',
  '      <div data-testid="listing-brand">Vintage</div>',
  '      <div data-testid="listing-title">Vintage band tee</div>',
  '      <div data-testid="listing-price">US $85</div>',
  '      <div data-testid="listing-size">M</div>',
  '      <div data-testid="listing-condition">Excellent</div>',
  '      <div data-testid="listing-category">Tops</div>',
  "    </a>",
  "  </article>",
  "</section>",
].join("\n");

export const grailedPartialSearchHtmlFixture = [
  '<section data-testid="search-results">',
  '  <article data-testid="listing-tile">',
  '    <a href="/listings/grailed-2001-unknown-archive-piece" aria-label="Unknown archive piece">',
  '      <div data-testid="listing-title">Unknown archive piece</div>',
  '      <div data-testid="listing-price">Offer</div>',
  "    </a>",
  "  </article>",
  "</section>",
].join("\n");

export const grailedNoResultsHtmlFixture = [
  '<section data-testid="search-results">',
  '  <div data-testid="empty-state">No listings found</div>',
  "</section>",
].join("\n");
