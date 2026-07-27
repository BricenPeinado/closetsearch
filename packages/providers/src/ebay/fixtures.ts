import type { EbayRawBrowseResponse } from "./raw.js";

export const ebayBrowseSearchFixture = {
  href: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=kapital&limit=2&offset=0",
  total: 3,
  next: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=kapital&limit=2&offset=2",
  limit: 2,
  offset: 0,
  itemSummaries: [
    {
      itemId: "v1|145100000001|0",
      legacyItemId: "145100000001",
      title: "Kapital patchwork denim jacket",
      itemAffiliateWebUrl: "https://www.ebay.com/itm/145100000001?campid=fixture-campaign",
      itemWebUrl: "https://www.ebay.com/itm/145100000001",
      image: {
        imageUrl: "https://i.ebayimg.com/images/g/fixture-1/s-l1600.jpg",
        width: 1600,
        height: 1600,
      },
      additionalImages: [
        {
          imageUrl: "https://i.ebayimg.com/images/g/fixture-2/s-l1600.jpg",
          width: 1600,
          height: 1600,
        },
      ],
      price: {
        value: "325.00",
        currency: "USD",
      },
      categories: [
        { categoryId: "11450", categoryName: "Clothing, Shoes & Accessories" },
        { categoryId: "57988", categoryName: "Coats, Jackets & Vests" },
      ],
      condition: "Pre-owned - Excellent",
      conditionId: "3000",
      buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
      localizedAspects: [
        { name: "Brand", value: "Kapital" },
        { name: "Size", value: "L" },
      ],
      seller: {
        username: "fixture-archivist",
        feedbackPercentage: "99.8",
        feedbackScore: 1842,
      },
      shippingOptions: [
        {
          shippingCost: { value: "12.50", currency: "USD" },
          shippingCostType: "FIXED",
          minEstimatedDeliveryDate: "2026-08-01T07:00:00.000Z",
          maxEstimatedDeliveryDate: "2026-08-05T07:00:00.000Z",
        },
      ],
      itemLocation: {
        city: "New York",
        stateOrProvince: "NY",
        country: "US",
      },
      listingMarketplaceId: "EBAY_US",
      itemOriginDate: "2026-07-20T14:30:00.000Z",
      itemCreationDate: "2026-07-20T14:30:00.000Z",
      itemEndDate: "2026-08-20T14:30:00.000Z",
    },
    {
      itemId: "v1|145100000002|0",
      title: "Kapital smiley knit",
      itemWebUrl: "https://www.ebay.com/itm/145100000002",
      image: {
        imageUrl: "https://i.ebayimg.com/images/g/fixture-3/s-l1600.jpg",
      },
      currentBidPrice: {
        value: "80.00",
        currency: "USD",
      },
      bidCount: 7,
      categories: [{ categoryId: "11484", categoryName: "Sweaters" }],
      condition: "Pre-owned - Good",
      buyingOptions: ["AUCTION"],
      localizedAspects: [
        { name: "Brand", value: "Kapital" },
        { name: "Size", value: "M" },
      ],
      seller: {
        username: "fixture-seller",
        feedbackPercentage: "96.1",
        feedbackScore: 28,
      },
      shippingOptions: [
        {
          shippingCost: { value: "0.00", currency: "USD" },
          shippingCostType: "FIXED",
        },
      ],
      listingMarketplaceId: "EBAY_US",
      itemOriginDate: "2026-07-22T10:00:00.000Z",
      itemEndDate: "2026-08-02T10:00:00.000Z",
    },
  ],
} satisfies EbayRawBrowseResponse;

export const ebayEmptySearchFixture = {
  href: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=missing",
  total: 0,
  limit: 50,
  offset: 0,
  itemSummaries: [],
} satisfies EbayRawBrowseResponse;

export const ebayChangedSchemaFixture = {
  total: 1,
  items: ebayBrowseSearchFixture.itemSummaries,
};

export const ebayMalformedSearchFixture = {
  ...ebayBrowseSearchFixture,
  total: 2,
  next: undefined,
  itemSummaries: [
    ebayBrowseSearchFixture.itemSummaries[0],
    {
      itemId: "malformed-no-destination",
      title: "Malformed listing",
      price: { value: "100.00", currency: "USD" },
      image: { imageUrl: "javascript:alert(1)" },
      itemWebUrl: "javascript:alert(1)",
    },
  ],
} satisfies EbayRawBrowseResponse;
