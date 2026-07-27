export interface MercariJpRawImage {
  height?: number;
  url?: string;
  width?: number;
}

export interface MercariJpRawSeller {
  id?: string;
  name?: string;
  ratingCount?: number;
}

export interface MercariJpRawShipping {
  domesticOnly?: boolean;
  feeBearer?: string;
  fromArea?: string;
  method?: string;
}

export interface MercariJpRawItem {
  brand?: { name?: string; translatedName?: string };
  category?: string;
  color?: string;
  condition?: string;
  createdAt?: string;
  description?: string;
  id?: string;
  images?: MercariJpRawImage[];
  itemUrl?: string;
  material?: string;
  name?: string;
  price?: number | string;
  relistedFromItemId?: string;
  seller?: MercariJpRawSeller;
  shipping?: MercariJpRawShipping;
  size?: string;
  status?: string;
  translatedDescription?: string;
  translatedName?: string;
  updatedAt?: string;
}

export interface MercariJpRawSearchResponse {
  items: unknown[];
  nextPageToken?: string;
  total?: number;
}
