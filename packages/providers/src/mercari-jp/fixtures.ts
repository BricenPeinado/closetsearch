import type { MercariJpRawSearchResponse } from "./raw.js";

export const mercariJpSearchFixture = {
  items: [
    {
      id: "m12345678901",
      name: "ヨウジヤマモト ウール ギャバジン ジャケット",
      translatedName: "Yohji Yamamoto wool gabardine jacket",
      description: "サイズ3。大切に保管していました。",
      translatedDescription: "Size 3. Carefully stored.",
      itemUrl: "https://jp.mercari.com/item/m12345678901",
      brand: { name: "ヨウジヤマモト", translatedName: "Yohji Yamamoto" },
      category: "ジャケット/アウター",
      size: "3",
      condition: "目立った傷や汚れなし",
      color: "ブラック",
      material: "ウール",
      price: 38_000,
      status: "on_sale",
      images: [
        {
          url: "https://static.mercdn.net/item/detail/orig/photos/m12345678901_1.jpg",
          width: 1080,
          height: 1080,
        },
      ],
      seller: { id: "mercari-seller-1", name: "tokyo_archive", ratingCount: 120 },
      shipping: {
        domesticOnly: true,
        feeBearer: "seller",
        fromArea: "東京都",
        method: "らくらくメルカリ便",
      },
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
    },
    {
      id: "m10987654321",
      name: "イッセイミヤケ プリーツ パンツ",
      itemUrl: "https://jp.mercari.com/item/m10987654321",
      brand: { name: "イッセイミヤケ", translatedName: "Issey Miyake" },
      category: "パンツ",
      size: "2",
      condition: "やや傷や汚れあり",
      price: 19_000,
      status: "sold_out",
      images: [
        {
          url: "https://static.mercdn.net/item/detail/orig/photos/m10987654321_1.jpg",
        },
      ],
      seller: { name: "fixture_mercari_seller" },
      createdAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-22T12:00:00.000Z",
    },
  ],
  nextPageToken: "mercari-next-2",
  total: 3,
} satisfies MercariJpRawSearchResponse;

export const mercariJpEmptySearchFixture = {
  items: [],
  total: 0,
} satisfies MercariJpRawSearchResponse;

export const mercariJpPartialSearchFixture = {
  items: [
    mercariJpSearchFixture.items[0],
    {
      id: "m-bad",
      name: "不正な商品",
      itemUrl: "https://www.mercari.com/us/item/m-bad",
      price: 100,
      images: [{ url: "https://attacker.invalid/image.jpg" }],
      status: "on_sale",
    },
  ],
  total: 2,
} satisfies MercariJpRawSearchResponse;

export const mercariJpChangedSchemaFixture = {
  entities: mercariJpSearchFixture.items,
  pageToken: "changed",
};
