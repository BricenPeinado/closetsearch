export interface Like {
  id: string;
  userId: string;
  listingId: string;
  source: string;
  createdAt: string;
}

export type Heart = Like;
