import type { Brand } from "@closetsearch/shared";

const brands: Brand[] = [
  {
    id: "brand:acne-studios",
    slug: "acne-studios",
    name: "Acne Studios",
    aliases: ["Acne"],
    tags: ["designer", "scandinavian", "minimal"],
  },
  {
    id: "brand:balenciaga",
    slug: "balenciaga",
    name: "Balenciaga",
    aliases: [],
    tags: ["designer", "luxury", "runway"],
  },
  {
    id: "brand:chrome-hearts",
    slug: "chrome-hearts",
    name: "Chrome Hearts",
    aliases: [],
    tags: ["streetwear", "jewelry", "luxury"],
  },
  {
    id: "brand:comme-des-garcons",
    slug: "comme-des-garcons",
    name: "Comme des Garçons",
    aliases: ["CDG", "Comme des Garcons"],
    tags: ["avant-garde", "designer", "japanese"],
  },
  {
    id: "brand:gucci",
    slug: "gucci",
    name: "Gucci",
    aliases: [],
    tags: ["designer", "luxury", "italian"],
  },
  {
    id: "brand:helmut-lang",
    slug: "helmut-lang",
    name: "Helmut Lang",
    aliases: [],
    tags: ["archive", "designer", "minimal"],
  },
  {
    id: "brand:hysteric-glamour",
    slug: "hysteric-glamour",
    name: "Hysteric Glamour",
    aliases: [],
    tags: ["japanese", "archive", "streetwear"],
  },
  {
    id: "brand:issey-miyake",
    slug: "issey-miyake",
    name: "Issey Miyake",
    aliases: ["IM"],
    tags: ["designer", "japanese", "pleats"],
  },
  {
    id: "brand:jean-paul-gaultier",
    slug: "jean-paul-gaultier",
    name: "Jean Paul Gaultier",
    aliases: ["JPG"],
    tags: ["designer", "archive", "runway"],
  },
  {
    id: "brand:kapital",
    slug: "kapital",
    name: "Kapital",
    aliases: [],
    tags: ["japanese", "workwear", "archive"],
  },
  {
    id: "brand:maison-margiela",
    slug: "maison-margiela",
    name: "Maison Margiela",
    aliases: ["Margiela", "MMM"],
    tags: ["designer", "avant-garde", "belgian"],
  },
  {
    id: "brand:number-n-ine",
    slug: "number-n-ine",
    name: "Number (N)ine",
    aliases: ["Number Nine", "Number N ine"],
    tags: ["archive", "japanese", "streetwear"],
  },
  {
    id: "brand:prada",
    slug: "prada",
    name: "Prada",
    aliases: [],
    tags: ["designer", "luxury", "italian"],
  },
  {
    id: "brand:raf-simons",
    slug: "raf-simons",
    name: "Raf Simons",
    aliases: [],
    tags: ["archive", "designer", "belgian"],
  },
  {
    id: "brand:rick-owens",
    slug: "rick-owens",
    name: "Rick Owens",
    aliases: [],
    tags: ["designer", "avant-garde", "darkwear"],
  },
  {
    id: "brand:supreme",
    slug: "supreme",
    name: "Supreme",
    aliases: [],
    tags: ["streetwear", "skate", "new-york"],
  },
  {
    id: "brand:stussy",
    slug: "stussy",
    name: "Stüssy",
    aliases: ["Stussy"],
    tags: ["streetwear", "surf", "california"],
  },
  {
    id: "brand:undercover",
    slug: "undercover",
    name: "Undercover",
    aliases: ["UC"],
    tags: ["archive", "japanese", "streetwear"],
  },
  {
    id: "brand:vivienne-westwood",
    slug: "vivienne-westwood",
    name: "Vivienne Westwood",
    aliases: [],
    tags: ["designer", "punk", "british"],
  },
  {
    id: "brand:yohji-yamamoto",
    slug: "yohji-yamamoto",
    name: "Yohji Yamamoto",
    aliases: ["Y's", "Yohji"],
    tags: ["designer", "avant-garde", "japanese"],
  },
];

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

function sortBrandsByName(items: Brand[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function matchesQuery(brand: Brand, query: string) {
  const normalizedQuery = normalizeValue(query);

  if (normalizedQuery.length === 0) {
    return true;
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const searchableFields = [brand.name, ...(brand.aliases ?? []), ...(brand.tags ?? [])]
    .map((value) => normalizeValue(value))
    .join(" ");

  return terms.every((term) => searchableFields.includes(term));
}

export function listBrands(query?: string) {
  const filteredBrands = query?.trim()
    ? brands.filter((brand) => matchesQuery(brand, query))
    : brands;

  return sortBrandsByName(filteredBrands);
}

export function findBrandBySlug(slug: string) {
  return brands.find((brand) => brand.slug === slug);
}
