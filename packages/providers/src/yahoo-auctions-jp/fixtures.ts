import type { YahooAuctionsJpRawSearchResponse } from "./raw.js";

export const yahooAuctionsJpSearchFixture = {
  listings: [
    {
      auctionId: "x123456789",
      title: "キャピタル BORO パッチワーク ジャケット",
      translatedTitle: "Kapital BORO patchwork jacket",
      description: "中古品です。状態は良好です。",
      translatedDescription: "Pre-owned in good condition.",
      itemUrl: "https://page.auctions.yahoo.co.jp/jp/auction/x123456789",
      brand: "キャピタル",
      brandAlias: "Kapital",
      category: "ジャケット",
      size: "3",
      condition: "中古：目立った傷や汚れなし",
      color: "インディゴ",
      material: "コットン",
      format: "auction",
      currentBid: { value: 28_000, currency: "JPY" },
      buyNowPrice: { value: 45_000, currency: "JPY" },
      bidCount: 7,
      auctionEndTime: "2026-08-01T12:00:00.000Z",
      startTime: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z",
      status: "active",
      images: [
        {
          url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/x123456789-1.jpg",
          width: 1200,
          height: 1200,
        },
      ],
      seller: { id: "seller-jp-1", username: "archive_tokyo", rating: 99.4 },
      shipping: {
        cost: { value: 1_200, currency: "JPY" },
        domesticOnly: true,
        payer: "buyer",
        prefecture: "東京都",
      },
    },
    {
      auctionId: "u987654321",
      title: "アンダーカバー Tシャツ",
      itemUrl: "https://page.auctions.yahoo.co.jp/jp/auction/u987654321",
      brand: "アンダーカバー",
      format: "auction",
      currentBid: { value: 8_000, currency: "JPY" },
      completedPrice: { value: 12_500, currency: "JPY" },
      bidCount: 11,
      auctionEndTime: "2026-07-20T12:00:00.000Z",
      status: "sold",
      images: [
        {
          url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/u987654321-1.jpg",
        },
      ],
      seller: { username: "fixture_yahoo_seller" },
      updatedAt: "2026-07-20T12:00:00.000Z",
    },
  ],
  pagination: { nextPage: 2, total: 3 },
} satisfies YahooAuctionsJpRawSearchResponse;

export const yahooAuctionsJpEmptySearchFixture = {
  listings: [],
  pagination: { total: 0 },
} satisfies YahooAuctionsJpRawSearchResponse;

export const yahooAuctionsJpPartialSearchFixture = {
  listings: [
    yahooAuctionsJpSearchFixture.listings[0],
    {
      auctionId: "bad-id",
      title: "不正なURL",
      itemUrl: "https://attacker.invalid/item",
      currentBid: { value: 100, currency: "JPY" },
      images: [{ url: "javascript:alert(1)" }],
    },
  ],
  pagination: { total: 2 },
} satisfies YahooAuctionsJpRawSearchResponse;

export const yahooAuctionsJpChangedSchemaFixture = {
  items: yahooAuctionsJpSearchFixture.listings,
  paging: { next: 2 },
};
