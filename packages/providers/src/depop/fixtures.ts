import type { DepopRawSearchResponse } from "./raw.js";

export const depopSearchFixture = {
  products: [
    {
      id: "depop-1001",
      title: "Kapital patchwork denim jacket",
      description: "Indigo patchwork jacket in excellent condition.",
      itemUrl: "https://www.depop.com/products/archive-depop-1001/",
      brand: { name: "Kapital", slug: "kapital" },
      category: "outerwear",
      condition: "excellent",
      size: "L",
      status: "active",
      price: { value: "245.00", currency: "USD" },
      images: [
        {
          url: "https://media-photos.depop.com/b1/fixture-depop-1001.jpg",
          width: 1200,
          height: 1200,
        },
      ],
      seller: { id: "seller-1", username: "archivecloset" },
      shipping: {
        cost: { value: "12.00", currency: "USD" },
        domesticOnly: false,
        payer: "buyer",
      },
      publishedAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
    },
    {
      id: "depop-1002",
      title: "Undercover graphic tee",
      itemUrl: "https://www.depop.com/products/archive-depop-1002/",
      brand: "Undercover",
      category: "tops",
      condition: "good",
      size: "M",
      status: "sold",
      price: { value: "90.00", currency: "USD" },
      images: [{ url: "https://media-photos.depop.com/b1/fixture-depop-1002.jpg" }],
      seller: { username: "fixture-seller" },
      publishedAt: "2026-07-18T10:00:00.000Z",
      updatedAt: "2026-07-24T09:00:00.000Z",
    },
  ],
  meta: {
    nextCursor: "depop-next-2",
    total: 3,
  },
} satisfies DepopRawSearchResponse;

export const depopEmptySearchFixture = {
  products: [],
  meta: { total: 0 },
} satisfies DepopRawSearchResponse;

export const depopPartialSearchFixture = {
  products: [
    depopSearchFixture.products[0],
    {
      id: "depop-malformed",
      title: "<script>bad</script>",
      itemUrl: "javascript:alert(1)",
      price: { value: "10.00", currency: "USD" },
    },
  ],
  meta: { total: 2 },
} satisfies DepopRawSearchResponse;

export const depopChangedSchemaFixture = {
  results: depopSearchFixture.products,
  pagination: { cursor: "changed" },
};
