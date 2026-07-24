export interface EbayRawAmount {
  currency?: string;
  value?: string;
}

export interface EbayRawAspect {
  name?: string;
  value?: string;
}

export interface EbayRawCategory {
  categoryId?: string;
  categoryName?: string;
}

export interface EbayRawImage {
  height?: number;
  imageUrl?: string;
  width?: number;
}

export interface EbayRawSeller {
  feedbackPercentage?: string;
  feedbackScore?: number;
  sellerAccountType?: string;
  username?: string;
}

export interface EbayRawShippingOption {
  maxEstimatedDeliveryDate?: string;
  minEstimatedDeliveryDate?: string;
  shippingCost?: EbayRawAmount;
  shippingCostType?: string;
  type?: string;
}

export interface EbayRawItemLocation {
  city?: string;
  country?: string;
  postalCode?: string;
  stateOrProvince?: string;
}

export interface EbayRawItemSummary {
  additionalImages?: EbayRawImage[];
  adultOnly?: boolean;
  buyingOptions?: string[];
  categories?: EbayRawCategory[];
  categoryPath?: string;
  condition?: string;
  conditionId?: string;
  currentBidPrice?: EbayRawAmount;
  image?: EbayRawImage;
  itemAffiliateWebUrl?: string;
  itemCreationDate?: string;
  itemEndDate?: string;
  itemId?: string;
  itemLocation?: EbayRawItemLocation;
  itemOriginDate?: string;
  itemWebUrl?: string;
  legacyItemId?: string;
  listingMarketplaceId?: string;
  localizedAspects?: EbayRawAspect[];
  price?: EbayRawAmount;
  seller?: EbayRawSeller;
  shippingOptions?: EbayRawShippingOption[];
  thumbnailImages?: EbayRawImage[];
  title?: string;
}

export interface EbayRawBrowseResponse {
  href?: string;
  itemSummaries?: EbayRawItemSummary[];
  limit?: number;
  next?: string;
  offset?: number;
  total?: number;
  warnings?: Array<{
    category?: string;
    errorId?: number;
    longMessage?: string;
    message?: string;
  }>;
}

export interface EbayRawOAuthResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}
