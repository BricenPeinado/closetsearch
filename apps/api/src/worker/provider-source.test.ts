import type { Provider } from "@closetsearch/providers";
import type { Listing } from "@closetsearch/shared";
import { describe, expect, it, vi } from "vitest";
import {
  ContractProviderIngestionSource,
  toListingObservation,
} from "./provider-source.js";

function listing(overrides: Partial<Listing> = {}): Listing {
  const fetchedAt =
    overrides.fetchedAt ?? "2026-07-24T12:00:00.000Z";

  return {
    brand: {
      id: "brand:kapital",
      name: "Kapital",
      slug: "kapital",
    },
    fetchedAt,
    id: "fixture:item-1",
    imageUrl: "https://images.example/item-1.jpg",
    images: [
      {
        role: "primary",
        url: "https://images.example/item-1.jpg",
      },
    ],
    listingType: "buy_now",
    price: {
      amount: 125,
      amountMinor: 12_500,
      currency: "USD",
      fractionDigits: 2,
    },
    pricing: {
      landed: {
        amount: 135,
        amountMinor: 13_500,
        currency: "USD",
        fractionDigits: 2,
      },
      original: {
        amount: 125,
        amountMinor: 12_500,
        currency: "USD",
        fractionDigits: 2,
      },
      shipping: {
        amount: 10,
        amountMinor: 1_000,
        currency: "USD",
        fractionDigits: 2,
      },
    },
    providerId: "fixture",
    providerListingId: "item-1",
    source: {
      dataOrigin: "official_api",
      id: "fixture",
      isMock: false,
      name: "Fixture Market",
    },
    sourceUrl: "https://market.example/items/item-1",
    title: "Kapital sashiko chore jacket",
    ...overrides,
  };
}

describe("provider ingestion source", () => {
  it("maps normalized exact money and stable observation identity", () => {
    const first = toListingObservation(listing(), "active");
    const replay = toListingObservation(
      listing({ fetchedAt: "2026-07-24T12:05:00.000Z" }),
      "active",
    );

    expect(first).toMatchObject({
      analyticsEligible: true,
      availability: "available",
      landedPrice: {
        amountMinor: 13_500n,
        currency: "USD",
      },
      listingType: "buy_now",
      marketStatus: "active",
      originalPrice: {
        amountMinor: 12_500n,
        currency: "USD",
      },
      providerId: "fixture",
      shippingPrice: {
        amountMinor: 1_000n,
        currency: "USD",
      },
      sourceListingId: "item-1",
    });
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.idempotencyKey).toBe(replay.idempotencyKey);
  });

  it("keeps confirmed sold price distinct from asking price", () => {
    const observation = toListingObservation(
      listing({
        lifecycle: {
          observedAt: "2026-07-24T12:00:00.000Z",
          soldAt: "2026-07-23T12:00:00.000Z",
          status: "sold",
        },
        market: {
          askingPrice: {
            amount: 140,
            amountMinor: 14_000,
            currency: "USD",
          },
          soldPrice: {
            amount: 120,
            amountMinor: 12_000,
            currency: "USD",
          },
          status: "sold",
        },
      }),
      "sold",
    );

    expect(observation).toMatchObject({
      availability: "sold",
      marketStatus: "sold",
      originalPrice: {
        amountMinor: 12_500n,
      },
      soldPrice: {
        amountMinor: 12_000n,
      },
    });
  });

  it("uses provider-native continuation without making live calls", async () => {
    const search = vi.fn<Provider["search"]>().mockResolvedValue({
      listings: [listing()],
      metadata: {
        dataOrigin: "official_api",
        fetchedAt: "2026-07-24T12:00:00.000Z",
        providerId: "fixture",
      },
      pagination: {
        hasMore: true,
        nextPage: 3,
        page: 2,
      },
      providerId: "fixture",
      status: "success",
    });
    const source = new ContractProviderIngestionSource(
      {
        dataOrigin: "official_api",
        id: "fixture",
        name: "Fixture",
        search,
      },
      [
        {
          key: "active:default",
          pageSize: 40,
          query: {
            marketScope: "active",
            sort: "newest",
            text: "designer clothing",
          },
        },
      ],
    );
    const controller = new AbortController();
    const page = await source.fetchPage({
      continuationCursor: { page: 2 },
      ingestionScope: "active",
      queryKey: "active:default",
      signal: controller.signal,
    });

    expect(search).toHaveBeenCalledWith({
      pagination: {
        cursor: undefined,
        page: 2,
        pageSize: 40,
      },
      query: {
        marketScope: "active",
        sort: "newest",
        text: "designer clothing",
      },
    });
    expect(page.continuationCursor).toEqual({ page: 3 });
    expect(page.listings).toHaveLength(1);
    expect(page.health).toMatchObject({
      metadata: {
        dataOrigin: "official_api",
        resultCount: 1,
      },
      state: "healthy",
    });
  });

  it("classifies terminal provider failures for the worker", async () => {
    const source = new ContractProviderIngestionSource(
      {
        id: "fixture",
        name: "Fixture",
        async search() {
          return {
            failure: {
              classification: "terminal",
              code: "authorization_required",
              message: "Approval is missing.",
              providerId: "fixture",
              retryable: false,
            },
            providerId: "fixture",
            status: "failure",
          };
        },
      },
      [
        {
          key: "active:default",
          pageSize: 20,
          query: {
            marketScope: "active",
            sort: "newest",
            text: "",
          },
        },
      ],
    );

    await expect(
      source.fetchPage({
        ingestionScope: "active",
        queryKey: "active:default",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "provider_authorization_required",
      terminal: true,
    });
  });
});
