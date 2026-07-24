import type {
  Like,
  NotificationPreferences,
  OnboardingPreferences,
  RecentSearch,
  SavedFilter,
  SavedSearch,
  User,
  UserSettings,
  Watchlist,
} from "@closetsearch/shared";

export type AccountTokenPurpose = "account_export" | "email_verification" | "password_reset";

export interface EmailIdentityRecord {
  createdAt: string;
  email: string;
  id: string;
  normalizedEmail: string;
  updatedAt: string;
  userId: string;
  verifiedAt?: string;
}

export interface AccountTokenRecord {
  consumedAt?: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  emailIdentityId?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  purpose: AccountTokenPurpose;
  userId: string;
}

export interface RequestAuthSession {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipHintRecorded: boolean;
  lastSeenAt: string;
  revokedAt?: string;
  userAgent?: string;
  userId: string;
}

export interface CreateRequestUserInput {
  createdAt?: Date;
  currencyPreference?: string;
  id?: string;
  onboardingPreferences?: OnboardingPreferences;
  passwordHash: string;
  preferredCurrency?: string;
  username: string;
}

export interface CreateRequestSessionInput {
  createdAt?: Date;
  expiresAt: Date;
  id?: string;
  ipHint?: string;
  sessionTokenHash: string;
  userAgent?: string;
  userId: string;
}

export interface RequestStoreOptions {
  ipHintPepper?: string;
  nodeEnv?: string;
  recentSearchLimit?: number;
}

export interface RequestAccountDataExport {
  account: User;
  alertMatches: Array<Record<string, unknown>>;
  emailIdentities: EmailIdentityRecord[];
  exportedAt: string;
  likes: Like[];
  notificationPreferences?: NotificationPreferences;
  recentSearches: RecentSearch[];
  savedFilters: SavedFilter[];
  savedSearches: SavedSearch[];
  schemaVersion: 2;
  securityNotice: string;
  sessions: RequestAuthSession[];
  settings?: UserSettings;
  watchlists: Watchlist[];
}

export type RequestStoreErrorCode =
  | "account_token_conflict"
  | "email_in_use"
  | "invalid_account_token"
  | "invalid_currency"
  | "invalid_email"
  | "invalid_identifier"
  | "invalid_ip_hint_configuration"
  | "invalid_notification_preferences"
  | "invalid_password_hash"
  | "invalid_saved_feature"
  | "invalid_session"
  | "invalid_username"
  | "invalid_watchlist"
  | "listing_not_persisted"
  | "username_taken"
  | "watchlist_conflict";

export class RequestStoreError extends Error {
  constructor(
    readonly code: RequestStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RequestStoreError";
  }
}
