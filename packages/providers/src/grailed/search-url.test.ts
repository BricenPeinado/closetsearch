import { describe, expect, it } from "vitest";
import { buildGrailedSearchUrl } from "./search-url";

describe("buildGrailedSearchUrl", () => {
  it("builds a public Grailed search URL from a text query", () => {
    const url = buildGrailedSearchUrl({
      baseUrl: "https://www.grailed.com",
      query: {
        text: "kapital coat",
      },
    });

    expect(url).toBe("https://www.grailed.com/shop?query=kapital+coat");
  });

  it("adds the public page parameter when paging is requested", () => {
    const url = buildGrailedSearchUrl({
      baseUrl: "https://www.grailed.com",
      query: {
        text: "kapital",
        page: 3,
        brandSlugs: ["kapital"],
        sort: "price_asc",
      },
    });

    expect(url).toBe("https://www.grailed.com/shop?query=kapital&page=3");
  });
});
