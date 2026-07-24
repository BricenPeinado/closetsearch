import { describe, expect, it } from "vitest";
import {
  CANONICAL_BRANDS,
  resolveCanonicalBrand,
} from "./brand-registry.js";

describe("canonical brand registry", () => {
  it("resolves maintained aliases and punctuation consistently", () => {
    expect(resolveCanonicalBrand("CDG")).toMatchObject({
      name: "Comme des Garçons",
      slug: "comme-des-garcons",
    });
    expect(resolveCanonicalBrand("Stussy")).toMatchObject({
      name: "Stüssy",
      slug: "stussy",
    });
    expect(resolveCanonicalBrand("Number Nine")).toMatchObject({
      name: "Number (N)ine",
      slug: "number-n-ine",
    });
  });

  it("returns a stable unknown brand without mutating maintained data", () => {
    const unknown = resolveCanonicalBrand("");

    expect(unknown).toEqual({
      id: "brand:unknown-brand",
      name: "Unknown brand",
      slug: "unknown-brand",
    });
    expect(CANONICAL_BRANDS.length).toBeGreaterThan(20);
  });
});
