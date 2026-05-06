export interface OnboardingPreferences {
  favoriteBrands: string[];
  categories: string[];
  priceRange: string;
}

export interface User {
  id: string;
  username: string;
  onboardingPreferences: OnboardingPreferences;
  currencyPreference: string;
  createdAt: string;
}

export interface StoredUser extends User {
  passwordHash: string;
}

export interface AuthResponse {
  userId: string;
  user: User;
}
