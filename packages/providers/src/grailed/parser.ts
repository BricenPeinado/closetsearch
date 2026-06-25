export interface ParsedGrailedListingCard {
  brand?: string;
  category?: string;
  condition?: string;
  imageUrl?: string;
  listingType?: string;
  priceText?: string;
  size?: string;
  sourceListingId?: string;
  sourceUrl?: string;
  title?: string;
}

const listingCardPattern = /<article[^>]*data-testid=["']listing-tile["'][^>]*>([\s\S]*?)<\/article>/gi;
const noResultsPattern = /(no listings found|no results)/i;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractAttribute(markup: string, attributeName: string) {
  const pattern = new RegExp(attributeName + "=[\"']([^\"']+)[\"']", "i");
  const match = markup.match(pattern);
  return match?.[1];
}

function extractDataText(markup: string, testId: string) {
  const pattern = new RegExp(
    "<[^>]*data-testid=[\\\"']" + testId + "[\\\"'][^>]*>([\\s\\S]*?)<\\/",
    "i",
  );
  const match = markup.match(pattern);
  return match ? stripTags(match[1]) : undefined;
}

function extractListingLink(markup: string) {
  const match = markup.match(/<a[^>]*href=["']([^"']*\/listings\/[^"']+)["'][^>]*>/i);
  return match?.[1];
}

function extractSourceListingId(markup: string, sourceUrl: string | undefined) {
  const explicitId = extractAttribute(markup, "data-listing-id");

  if (explicitId) {
    return explicitId;
  }

  if (!sourceUrl) {
    return undefined;
  }

  const match = sourceUrl.match(/\/listings\/([^/?#]+)/i);
  return match?.[1];
}

export function hasGrailedNoResultsState(html: string) {
  return noResultsPattern.test(html);
}

export function parseGrailedListingCards(html: string): ParsedGrailedListingCard[] {
  const cards: ParsedGrailedListingCard[] = [];

  for (const match of html.matchAll(listingCardPattern)) {
    const markup = match[1] ?? "";
    const sourceUrl = extractListingLink(markup);
    const title = extractDataText(markup, "listing-title") ?? extractAttribute(markup, "aria-label");

    cards.push({
      sourceUrl,
      sourceListingId: extractSourceListingId(markup, sourceUrl),
      title,
      brand: extractDataText(markup, "listing-brand"),
      imageUrl: extractAttribute(markup, "src") ?? extractAttribute(markup, "data-src"),
      priceText: extractDataText(markup, "listing-price"),
      size: extractDataText(markup, "listing-size"),
      condition: extractDataText(markup, "listing-condition"),
      category: extractDataText(markup, "listing-category"),
      listingType: extractAttribute(markup, "data-listing-type"),
    });
  }

  return cards;
}
