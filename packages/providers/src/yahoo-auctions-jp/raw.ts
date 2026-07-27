export interface YahooAuctionsJpRawMoney {
  currency?: string;
  value?: number | string;
}

export interface YahooAuctionsJpRawImage {
  height?: number;
  url?: string;
  width?: number;
}

export interface YahooAuctionsJpRawSeller {
  id?: string;
  rating?: number;
  username?: string;
}

export interface YahooAuctionsJpRawShipping {
  cost?: YahooAuctionsJpRawMoney;
  domesticOnly?: boolean;
  payer?: string;
  prefecture?: string;
}

export interface YahooAuctionsJpRawListing {
  auctionEndTime?: string;
  auctionId?: string;
  bidCount?: number;
  brand?: string;
  brandAlias?: string;
  buyNowPrice?: YahooAuctionsJpRawMoney;
  category?: string;
  color?: string;
  completedPrice?: YahooAuctionsJpRawMoney;
  condition?: string;
  currentBid?: YahooAuctionsJpRawMoney;
  description?: string;
  format?: string;
  images?: YahooAuctionsJpRawImage[];
  itemUrl?: string;
  material?: string;
  relistedFromAuctionId?: string;
  seller?: YahooAuctionsJpRawSeller;
  shipping?: YahooAuctionsJpRawShipping;
  size?: string;
  startTime?: string;
  status?: string;
  title?: string;
  translatedDescription?: string;
  translatedTitle?: string;
  updatedAt?: string;
}

export interface YahooAuctionsJpRawSearchResponse {
  listings: unknown[];
  pagination?: {
    nextPage?: number;
    total?: number;
  };
}
