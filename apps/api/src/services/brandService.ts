import {
  CANONICAL_BRANDS,
  type Brand,
} from "@closetsearch/shared";

function normalizeValue(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function cloneBrand(brand: Brand): Brand {
  return {
    ...brand,
    aliases: brand.aliases ? [...brand.aliases] : undefined,
    tags: brand.tags ? [...brand.tags] : undefined,
  };
}

function matchesQuery(brand: Brand, query: string) {
  const terms = normalizeValue(query).split(/\s+/).filter(Boolean);
  const searchableFields = [
    brand.name,
    ...(brand.aliases ?? []),
    ...(brand.tags ?? []),
  ]
    .map(normalizeValue)
    .join(" ");

  return terms.every((term) => searchableFields.includes(term));
}

export function listBrands(query?: string) {
  return CANONICAL_BRANDS.filter(
    (brand) => !query?.trim() || matchesQuery(brand, query),
  )
    .map(cloneBrand)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findBrandBySlug(slug: string) {
  const brand = CANONICAL_BRANDS.find((candidate) => candidate.slug === slug);
  return brand ? cloneBrand(brand) : undefined;
}
