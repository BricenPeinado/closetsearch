export interface DepopRawMoney {
  currency?: string;
  value?: number | string;
}

export interface DepopRawImage {
  height?: number;
  url?: string;
  width?: number;
}

export interface DepopRawSeller {
  id?: string;
  username?: string;
}

export interface DepopRawShipping {
  cost?: DepopRawMoney;
  domesticOnly?: boolean;
  payer?: string;
}

export interface DepopRawProduct {
  brand?: { name?: string; slug?: string } | string;
  category?: string;
  condition?: string;
  description?: string;
  id?: string;
  images?: DepopRawImage[];
  itemUrl?: string;
  price?: DepopRawMoney;
  publishedAt?: string;
  relistedFromId?: string;
  seller?: DepopRawSeller;
  shipping?: DepopRawShipping;
  size?: string;
  status?: string;
  title?: string;
  updatedAt?: string;
}

export interface DepopRawSearchResponse {
  meta?: {
    nextCursor?: string;
    total?: number;
  };
  products: unknown[];
}
