export interface Brand {
  id: string;
  name: string;
  slug: string;
}

export interface SearchQuery {
  text: string;
  brandId?: string;
  size?: string;
  maxPrice?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  brand?: Brand;
  price: {
    amount: number;
    currency: string;
  };
  imageUrl?: string;
  productUrl: string;
  providerId: string;
}
