import type {
  OnboardingPreferences,
  PersistSavedFilterInput,
  PersistSearchHistoryInput,
  PersistWatchlistInput,
  UpdateNotificationPreferencesInput,
  UpdateUserSettingsInput,
  UpdateWatchlistInput,
} from "@closetsearch/shared";
import type { PostgresDatabase } from "./database.js";
import { RequestAccountRepository } from "./repositories/request-accounts.js";
import { RequestFeatureRepository } from "./repositories/request-features.js";
import { normalizeUsername, toIso } from "./request-store-common.js";
import type {
  AccountTokenPurpose,
  CreateRequestSessionInput,
  CreateRequestUserInput,
  RequestAccountDataExport,
  RequestStoreOptions,
} from "./request-store-types.js";
import type { PgQueryable } from "./types.js";

export class PostgresRequestStore {
  private readonly accounts: RequestAccountRepository;
  private readonly features: RequestFeatureRepository;

  constructor(
    private readonly database: PostgresDatabase,
    private readonly options: RequestStoreOptions = {},
    private readonly queryable: PgQueryable = database,
  ) {
    this.accounts = new RequestAccountRepository(queryable, options);
    this.features = new RequestFeatureRepository(queryable);
  }

  async withTransaction<T>(operation: (store: PostgresRequestStore) => Promise<T>) {
    if (this.queryable !== this.database) {
      return operation(this);
    }

    return this.database.withTransaction((client) =>
      operation(new PostgresRequestStore(this.database, this.options, client)),
    );
  }

  createUser(input: CreateRequestUserInput) {
    return this.withTransaction((store) => store.accounts.createUser(input));
  }

  findUserById(userId: string) {
    return this.accounts.findUserById(userId);
  }

  findUserCredentialsByNormalizedUsername(normalizedUsername: string) {
    return this.accounts.findCredentialsByNormalizedUsername(normalizedUsername);
  }

  updatePasswordHash(userId: string, passwordHash: string) {
    return this.accounts.updatePasswordHash(userId, passwordHash);
  }

  updateOnboarding(userId: string, preferences: OnboardingPreferences, preferredCurrency: string) {
    return this.accounts.updateOnboarding(userId, preferences, preferredCurrency);
  }

  getUserSettings(userId: string) {
    return this.accounts.getSettings(userId);
  }

  updateUserSettings(input: UpdateUserSettingsInput) {
    return this.withTransaction((store) => store.accounts.updateSettings(input));
  }

  deleteAccount(userId: string, confirmationUsername?: string) {
    return this.withTransaction((store) =>
      store.accounts.deleteUser(
        userId,
        confirmationUsername
          ? normalizeUsername(confirmationUsername).normalizedUsername
          : undefined,
      ),
    );
  }

  findEmailIdentityByUserId(userId: string) {
    return this.accounts.findEmailIdentityByUserId(userId);
  }

  findEmailIdentityById(identityId: string) {
    return this.accounts.findEmailIdentityById(identityId);
  }

  findEmailIdentityByNormalizedEmail(email: string) {
    return this.accounts.findEmailIdentityByNormalizedEmail(email);
  }

  listEmailIdentities(userId: string) {
    return this.accounts.listEmailIdentities(userId);
  }

  upsertEmailIdentity(input: { createdAt?: Date; email: string; id?: string; userId: string }) {
    return this.withTransaction(async (store) => {
      const previous = await store.accounts.findEmailIdentityByUserId(input.userId);
      const identity = await store.accounts.upsertEmailIdentity(input);

      if (previous && previous.normalizedEmail !== identity.normalizedEmail) {
        await store.accounts.invalidateActiveAccountTokens({
          invalidatedAt: input.createdAt,
          reason: "email_identity_changed",
          userId: input.userId,
        });
      }

      return identity;
    });
  }

  markEmailIdentityVerified(identityId: string, userId: string, verifiedAt?: Date) {
    return this.accounts.markEmailVerified(identityId, userId, verifiedAt);
  }

  issueAccountToken(input: {
    createdAt?: Date;
    expiresAt: Date;
    id?: string;
    emailIdentityId?: string;
    purpose: AccountTokenPurpose;
    tokenHash: string;
    userId: string;
  }) {
    return this.withTransaction(async (store) => {
      await store.accounts.invalidateActiveAccountTokens({
        invalidatedAt: input.createdAt,
        purpose: input.purpose,
        reason: "superseded",
        userId: input.userId,
      });
      return store.accounts.insertAccountToken(input);
    });
  }

  findActiveAccountToken(tokenHash: string, purpose: AccountTokenPurpose, at?: Date) {
    return this.accounts.findActiveAccountToken(tokenHash, purpose, at);
  }

  consumeActiveAccountToken(tokenHash: string, purpose: AccountTokenPurpose, consumedAt?: Date) {
    return this.accounts.consumeActiveAccountToken(tokenHash, purpose, consumedAt);
  }

  invalidateAccountTokens(input: {
    invalidatedAt?: Date;
    purpose?: AccountTokenPurpose;
    reason: string;
    userId: string;
  }) {
    return this.accounts.invalidateActiveAccountTokens(input);
  }

  deleteExpiredAccountTokens(expiredAt: Date, createdBefore: Date, limit?: number) {
    return this.accounts.deleteExpiredAccountTokens(expiredAt, createdBefore, limit);
  }

  createAuthSession(input: CreateRequestSessionInput) {
    return this.accounts.createSession(input);
  }

  findAuthSessionByTokenHash(sessionTokenHash: string) {
    return this.accounts.findSessionByTokenHash(sessionTokenHash);
  }

  resolveAuthSessionByTokenHash(sessionTokenHash: string, at?: Date) {
    return this.accounts.findActiveSession(sessionTokenHash, at);
  }

  touchAuthSession(sessionId: string, seenAt?: Date) {
    return this.accounts.touchSession(sessionId, seenAt);
  }

  touchAuthSessionByTokenHash(sessionTokenHash: string, seenAt?: Date) {
    return this.accounts.touchSessionByTokenHash(sessionTokenHash, seenAt);
  }

  revokeAuthSessionByTokenHash(sessionTokenHash: string, revokedAt?: Date) {
    return this.accounts.revokeSession(sessionTokenHash, revokedAt);
  }

  revokeAuthSessionsByUserId(userId: string, revokedAt?: Date) {
    return this.accounts.revokeSessionsForUser(userId, revokedAt);
  }

  listLikesByUserId(userId: string) {
    return this.features.listLikes(userId);
  }

  upsertLike(input: {
    createdAt?: Date;
    id?: string;
    listingId: string;
    source?: string;
    userId: string;
  }) {
    return this.features.upsertLike(input);
  }

  deleteLike(input: { id?: string; listingId?: string; userId: string }) {
    return this.features.deleteLike(input);
  }

  listRecentSearchesByUserId(userId: string) {
    return this.features.listRecentSearches(userId);
  }

  upsertRecentSearch(input: PersistSearchHistoryInput) {
    return this.withTransaction((store) =>
      store.features.upsertRecentSearch(input, this.options.recentSearchLimit),
    );
  }

  clearRecentSearches(userId: string) {
    return this.features.clearRecentSearches(userId);
  }

  listSavedSearchesByUserId(userId: string) {
    return this.features.listSavedSearches(userId);
  }

  upsertSavedSearch(input: PersistSearchHistoryInput) {
    return this.features.upsertSavedSearch(input);
  }

  deleteSavedSearch(input: { id?: string; params?: string; userId: string }) {
    return this.features.deleteSavedSearch(input);
  }

  listSavedFiltersByUserId(userId: string) {
    return this.features.listSavedFilters(userId);
  }

  upsertSavedFilter(input: PersistSavedFilterInput) {
    return this.features.upsertSavedFilter(input);
  }

  deleteSavedFilter(userId: string, id: string) {
    return this.features.deleteSavedFilter(userId, id);
  }

  listWatchlistsByUserId(userId: string) {
    return this.features.listWatchlists(userId);
  }

  findWatchlistByUserIdAndId(userId: string, id: string) {
    return this.features.findWatchlist(userId, id);
  }

  createWatchlist(input: PersistWatchlistInput) {
    return this.features.createWatchlist(input);
  }

  updateWatchlist(input: UpdateWatchlistInput) {
    return this.withTransaction((store) => store.features.updateWatchlist(input));
  }

  deleteWatchlist(userId: string, id: string) {
    return this.features.deleteWatchlist(userId, id);
  }

  getNotificationPreferencesByUserId(userId: string) {
    return this.features.getNotificationPreferences(userId);
  }

  updateNotificationPreferences(input: UpdateNotificationPreferencesInput) {
    return this.withTransaction((store) => store.features.updateNotificationPreferences(input));
  }

  exportAccountData(
    userId: string,
    exportedAt = new Date(),
  ): Promise<RequestAccountDataExport | undefined> {
    return this.withTransaction(async (store) => {
      const account = await store.accounts.findUserById(userId);

      if (!account) {
        return undefined;
      }

      const [
        alertMatches,
        emailIdentities,
        likes,
        notificationPreferences,
        recentSearches,
        savedFilters,
        savedSearches,
        sessions,
        settings,
        watchlists,
      ] = await Promise.all([
        store.features.listAlertMatchesForExport(userId),
        store.accounts.listEmailIdentities(userId),
        store.features.listLikes(userId),
        store.features.getNotificationPreferences(userId),
        store.features.listRecentSearches(userId),
        store.features.listSavedFilters(userId),
        store.features.listSavedSearches(userId),
        store.accounts.listSessions(userId),
        store.accounts.getSettings(userId),
        store.features.listWatchlists(userId),
      ]);

      return {
        account,
        alertMatches,
        emailIdentities,
        exportedAt: toIso(exportedAt),
        likes,
        notificationPreferences,
        recentSearches,
        savedFilters,
        savedSearches,
        schemaVersion: 2,
        securityNotice:
          "Password hashes, session-token hashes, IP-hint hashes, and one-time account-token hashes are excluded.",
        sessions,
        settings,
        watchlists,
      };
    });
  }
}
