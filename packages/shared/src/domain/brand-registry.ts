import type { Brand } from "./brand.js";

/**
 * Maintained canonical brand data used by provider normalization and the
 * directory. Add aliases here rather than introducing provider-specific
 * spelling rules.
 */
export const CANONICAL_BRANDS: readonly Brand[] = [
  {
    aliases: ["Acne"],
    id: "brand:acne-studios",
    name: "Acne Studios",
    slug: "acne-studios",
    tags: ["designer", "scandinavian", "minimal"],
  },
  {
    aliases: [],
    id: "brand:balenciaga",
    name: "Balenciaga",
    slug: "balenciaga",
    tags: ["designer", "luxury", "runway"],
  },
  {
    aliases: [],
    id: "brand:chrome-hearts",
    name: "Chrome Hearts",
    slug: "chrome-hearts",
    tags: ["streetwear", "jewelry", "luxury"],
  },
  {
    aliases: ["CDG", "Comme des Garcons", "コムデギャルソン", "コム デ ギャルソン"],
    id: "brand:comme-des-garcons",
    name: "Comme des Garçons",
    slug: "comme-des-garcons",
    tags: ["avant-garde", "designer", "japanese"],
  },
  {
    aliases: [],
    id: "brand:gucci",
    name: "Gucci",
    slug: "gucci",
    tags: ["designer", "luxury", "italian"],
  },
  {
    aliases: [],
    id: "brand:helmut-lang",
    name: "Helmut Lang",
    slug: "helmut-lang",
    tags: ["archive", "designer", "minimal"],
  },
  {
    aliases: ["ヒステリックグラマー"],
    id: "brand:hysteric-glamour",
    name: "Hysteric Glamour",
    slug: "hysteric-glamour",
    tags: ["japanese", "archive", "streetwear"],
  },
  {
    aliases: ["IM", "イッセイミヤケ", "イッセイ ミヤケ"],
    id: "brand:issey-miyake",
    name: "Issey Miyake",
    slug: "issey-miyake",
    tags: ["designer", "japanese", "pleats"],
  },
  {
    aliases: ["JPG"],
    id: "brand:jean-paul-gaultier",
    name: "Jean Paul Gaultier",
    slug: "jean-paul-gaultier",
    tags: ["designer", "archive", "runway"],
  },
  {
    aliases: ["キャピタル"],
    id: "brand:kapital",
    name: "Kapital",
    slug: "kapital",
    tags: ["japanese", "workwear", "archive"],
  },
  {
    aliases: ["Margiela", "MMM"],
    id: "brand:maison-margiela",
    name: "Maison Margiela",
    slug: "maison-margiela",
    tags: ["designer", "avant-garde", "belgian"],
  },
  {
    aliases: ["Number Nine", "Number N ine", "ナンバーナイン", "ナンバー ナイン"],
    id: "brand:number-n-ine",
    name: "Number (N)ine",
    slug: "number-n-ine",
    tags: ["archive", "japanese", "streetwear"],
  },
  {
    aliases: [],
    id: "brand:our-legacy",
    name: "Our Legacy",
    slug: "our-legacy",
    tags: ["designer", "scandinavian", "contemporary"],
  },
  {
    aliases: [],
    id: "brand:prada",
    name: "Prada",
    slug: "prada",
    tags: ["designer", "luxury", "italian"],
  },
  {
    aliases: [],
    id: "brand:raf-simons",
    name: "Raf Simons",
    slug: "raf-simons",
    tags: ["archive", "designer", "belgian"],
  },
  {
    aliases: [],
    id: "brand:rick-owens",
    name: "Rick Owens",
    slug: "rick-owens",
    tags: ["designer", "avant-garde", "darkwear"],
  },
  {
    aliases: [],
    id: "brand:stone-island",
    name: "Stone Island",
    slug: "stone-island",
    tags: ["sportswear", "technical", "italian"],
  },
  {
    aliases: [],
    id: "brand:supreme",
    name: "Supreme",
    slug: "supreme",
    tags: ["streetwear", "skate", "new-york"],
  },
  {
    aliases: ["Stussy"],
    id: "brand:stussy",
    name: "Stüssy",
    slug: "stussy",
    tags: ["streetwear", "surf", "california"],
  },
  {
    aliases: ["UC", "アンダーカバー"],
    id: "brand:undercover",
    name: "Undercover",
    slug: "undercover",
    tags: ["archive", "japanese", "streetwear"],
  },
  {
    aliases: [],
    id: "brand:vivienne-westwood",
    name: "Vivienne Westwood",
    slug: "vivienne-westwood",
    tags: ["designer", "punk", "british"],
  },
  {
    aliases: ["Y's", "Yohji", "ヨウジヤマモト", "ヨウジ ヤマモト"],
    id: "brand:yohji-yamamoto",
    name: "Yohji Yamamoto",
    slug: "yohji-yamamoto",
    tags: ["designer", "avant-garde", "japanese"],
  },
  {
    aliases: ["Visvim", "ヴィズヴィム", "ビズビム"],
    id: "brand:visvim",
    name: "Visvim",
    slug: "visvim",
    tags: ["designer", "japanese", "workwear"],
  },
];

function normalizeBrandKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value: string) {
  return normalizeBrandKey(value).replace(/\s+/g, "-") || "unknown-brand";
}

const brandByKey = new Map<string, Brand>();

for (const brand of CANONICAL_BRANDS) {
  for (const value of [brand.id, brand.slug, brand.name, ...(brand.aliases ?? [])]) {
    brandByKey.set(normalizeBrandKey(value), brand);
  }
}

function cloneBrand(brand: Brand): Brand {
  return {
    ...brand,
    aliases: brand.aliases ? [...brand.aliases] : undefined,
    tags: brand.tags ? [...brand.tags] : undefined,
  };
}

export function resolveCanonicalBrand(
  value: string | null | undefined,
  providerSlug?: string | null,
): Brand {
  const name = value?.trim() || "Unknown brand";
  const canonical =
    brandByKey.get(normalizeBrandKey(name)) ??
    (providerSlug ? brandByKey.get(normalizeBrandKey(providerSlug)) : undefined);

  if (canonical) {
    return cloneBrand(canonical);
  }

  const slug = slugify(providerSlug?.trim() || name);

  return {
    id: `brand:${slug}`,
    name: slug === "unknown-brand" ? "Unknown brand" : name,
    slug,
  };
}
