import type { SearchQuery } from "@closetsearch/shared";
import type { Provider } from "../types";

export const mockProvider: Provider = {
  id: "mock",
  name: "Mock Provider",
  capabilities: {
    supportsPagination: false,
    supportsPriceRange: true,
    supportedListingTypes: ["auction", "buy_now", "unknown"],
    supportedSortModes: ["relevance", "price_asc", "price_desc", "newest"],
  },
  async search(_query: SearchQuery) {
    return {
      providerId: "mock",
      status: "success",
      listings: [],
      hasMore: false,
      metadata: {
        providerId: "mock",
        fetchedAt: "1970-01-01T00:00:00.000Z",
      },
    };
  },
};
