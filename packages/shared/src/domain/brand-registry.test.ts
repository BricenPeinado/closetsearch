import { describe, expect, it } from "vitest";
import { CANONICAL_BRANDS, resolveCanonicalBrand } from "./brand-registry.js";

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

  it("resolves Japanese aliases without collapsing Unicode brand keys", () => {
    expect(resolveCanonicalBrand("キャピタル")).toMatchObject({
      name: "Kapital",
      slug: "kapital",
    });
    expect(resolveCanonicalBrand("コム デ ギャルソン")).toMatchObject({
      name: "Comme des Garçons",
      slug: "comme-des-garcons",
    });
    expect(resolveCanonicalBrand("ヴィズヴィム")).toMatchObject({
      name: "Visvim",
      slug: "visvim",
    });

    expect(resolveCanonicalBrand("未知ブランド")).toMatchObject({
      name: "未知ブランド",
      slug: "未知ブランド",
    });
    expect(resolveCanonicalBrand("別ブランド").slug).not.toBe(
      resolveCanonicalBrand("未知ブランド").slug,
    );
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
