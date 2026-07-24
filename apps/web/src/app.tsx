import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  AnalyticsOverview,
  AuthResponse,
  Brand,
  BrandMarketSummary,
  CategoryMarketSummary,
  FeedResponse,
  LikedListing,
  Like,
  Listing,
  NotificationPreferences,
  PaginationInfo,
  PersonalizationSummary,
  PremiumAccess,
  SavedFilter,
  SavedSearch,
  SearchProviderSummary,
  SearchResponse,
  SearchSortMode,
  UnderpricedListingSignal,
  UserSettings,
  Watchlist,
} from "@closetsearch/shared";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { fetchJson, sendJson } from "./api-client";
import { mergeUniqueListings } from "./listing-pagination";
import { ListingCard, type ListingCardEngagementContext } from "./components/listing-card";
import { InfiniteScrollSentinel } from "./components/infinite-scroll-sentinel";
import { ScrollPositionRestoration } from "./components/scroll-position-restoration";
import { AccountSecurityPanel } from "./components/account-security";
import {
  AccountExportPage,
  EmailVerificationPage,
  PasswordResetCompletePage,
  PasswordResetRequestPage,
} from "./components/account-action-pages";
import { AlertInboxPage } from "./components/alert-inbox";
import {
  createEngagementId,
  isListingEngagementEligible,
  recordEngagementEvent,
} from "./engagement-client";
import {
  buildSearchPath,
  clearRecentSearches,
  createRecentSearchEntry,
  createDefaultSearchFormValues,
  createSearchParams,
  describeSearch,
  hasActiveSearchValues,
  loadRecentSearches,
  parseSearchFormValues,
  saveRecentSearch,
  type RecentSearchEntry,
  type SearchFormValues,
} from "./search-utils";
import { getAuthErrorMessage, isAuthRequiredError, loadUserSession } from "./user-session";

const primaryNavigationItems = [
  { label: "Home", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Brands", path: "/brands" },
  { label: "Analytics", path: "/analytics" },
  { label: "Alerts", path: "/alerts" },
  { label: "Profile", path: "/profile" },
] as const;
const betaFeedbackUrl = "https://github.com/BricenPeinado/closetsearch/issues/new/choose";

const homeFeedPageSize = 12;
const searchResultsPageSize = 24;
const sortOptions: Array<{ label: string; value: SearchSortMode }> = [
  { label: "Relevance", value: "relevance" },
  { label: "Price low to high", value: "price_asc" },
  { label: "Price high to low", value: "price_desc" },
  { label: "Newest first", value: "newest" },
];
const allMarketplaceOption = {
  label: "All available marketplaces",
  value: "",
};
const listingTypeOptions = [
  { label: "All listing types", value: "" },
  { label: "Fixed price", value: "buy_now" },
  { label: "Auction", value: "auction" },
];
const conditionOptions = [
  { label: "All conditions", value: "" },
  { label: "New with tags", value: "new_with_tags" },
  { label: "New without tags", value: "new_without_tags" },
  { label: "Excellent", value: "excellent" },
  { label: "Good", value: "good" },
  { label: "Fair", value: "fair" },
];
const marketStatusOptions = [
  { label: "Active and sold", value: "" },
  { label: "Active", value: "active" },
  { label: "Sold", value: "sold" },
];
const currencyOptions = ["", "USD", "EUR", "GBP", "CAD", "AUD", "JPY"];
interface PageTemplateProps {
  title?: string;
  description?: string;
  children?: ReactNode;
}

interface FeedRequestState {
  engagementRequestId?: string;
  errorMessage?: string;
  isLoadingMore: boolean;
  isPersonalized: boolean;
  listings: Listing[];
  loadMoreErrorMessage?: string;
  pagination?: PaginationInfo;
  personalizationSummary?: PersonalizationSummary;
  providers?: SearchProviderSummary[];
  status: "loading" | "success" | "error";
}

interface ProviderHealthResponse {
  providers: Array<{
    active: boolean;
    displayName: string;
    id: string;
    implementationStatus: string;
  }>;
}

function useMarketplaceOptions() {
  const [marketplaceOptions, setMarketplaceOptions] = useState([allMarketplaceOption]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchJson<ProviderHealthResponse>("/providers/health", controller.signal)
      .then((response) => {
        const availableOptions = response.providers
          .filter((provider) => provider.active && provider.implementationStatus === "available")
          .map((provider) => ({
            label: provider.displayName,
            value: provider.id,
          }))
          .sort((left, right) => left.label.localeCompare(right.label));

        setMarketplaceOptions([allMarketplaceOption, ...availableOptions]);
      })
      .catch(() => {
        // Forms remain usable when provider health metadata is unavailable.
      });

    return () => controller.abort();
  }, []);

  return marketplaceOptions;
}

interface SearchRequestState {
  errorMessage?: string;
  isLoadingMore: boolean;
  loadMoreErrorMessage?: string;
  response?: SearchResponse;
  status: "idle" | "loading" | "success" | "error";
}

interface LikeMutationResponse {
  likedListing: LikedListing;
  userId: string;
}

interface RecentSearchesResponse {
  recentSearches: RecentSearchEntry[];
  userId: string;
}

interface LikesResponse {
  likedListings: LikedListing[];
  likes: Like[];
  userId: string;
}

interface SavedSearchesResponse {
  savedSearch?: SavedSearch;
  savedSearches: SavedSearch[];
  userId: string;
}

interface SavedFiltersResponse {
  savedFilter?: SavedFilter;
  savedFilters: SavedFilter[];
  userId: string;
}

interface WatchlistsResponse {
  watchlist?: Watchlist;
  watchlists: Watchlist[];
  userId: string;
}

interface NotificationPreferencesResponse {
  notificationPreferences: NotificationPreferences;
  userId: string;
}

interface SettingsResponse {
  settings: UserSettings;
  userId: string;
}

interface ProfileCollectionsState {
  errorMessage?: string;
  notificationPreferences?: NotificationPreferences;
  savedFilters: SavedFilter[];
  savedSearches: SavedSearch[];
  settings?: UserSettings;
  status: "loading" | "success" | "error";
  watchlists: Watchlist[];
}

interface WatchlistFormState {
  brand: string;
  category: string;
  condition: string;
  enabled: boolean;
  label: string;
  listingType: SearchFormValues["listingType"];
  maxPriceAmount: string;
  minPriceAmount: string;
  priceCurrency: string;
  queryText: string;
  size: string;
  source: string;
}

interface BrandListResponse {
  brands: Brand[];
  query?: string;
  total: number;
}

interface BrandDetailResponse {
  brand: Brand;
}

interface BrandListRequestState {
  brands: Brand[];
  errorMessage?: string;
  status: "loading" | "success" | "error";
  total: number;
}

interface BrandDetailRequestState {
  brand?: Brand;
  errorMessage?: string;
  status: "loading" | "success" | "error";
}

interface AnalyticsOverviewResponse {
  locked: boolean;
  message?: string;
  overview?: AnalyticsOverview;
  premiumAccess?: PremiumAccess;
  sampleData?: boolean;
}

interface MarketInsightsResponse {
  brandSummaries?: BrandMarketSummary[];
  categorySummaries?: CategoryMarketSummary[];
  locked: boolean;
  message?: string;
  premiumAccess?: PremiumAccess;
  sampleData?: boolean;
}

interface UnderpricedSignalsResponse {
  locked: boolean;
  message?: string;
  premiumAccess?: PremiumAccess;
  sampleData?: boolean;
  signals?: UnderpricedListingSignal[];
}

interface AnalyticsRequestState {
  brandSummaries: BrandMarketSummary[];
  categorySummaries: CategoryMarketSummary[];
  errorMessage?: string;
  locked: boolean;
  message?: string;
  overview?: AnalyticsOverview;
  premiumAccess?: PremiumAccess;
  sampleData: boolean;
  signals: UnderpricedListingSignal[];
  status: "loading" | "success" | "error";
}

function PageTemplate({ title, description, children }: PageTemplateProps) {
  return (
    <section className="page-shell">
      {title || description ? (
        <header className="page-header">
          {title ? <h1>{title}</h1> : null}
          {description ? <p className="page-description">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function StateCard({ action, body, title }: { action?: ReactNode; body: string; title: string }) {
  return (
    <section className="state-card">
      <h2>{title}</h2>
      <p>{body}</p>
      {action ? <div className="state-card__action">{action}</div> : null}
    </section>
  );
}

function parseCommaSeparatedList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBrandSearchPath(brandName: string) {
  return buildSearchPath({
    ...createDefaultSearchFormValues(),
    query: brandName,
  });
}

function formatBrandMetadata(brand: Brand) {
  const aliases = brand.aliases?.length ? `${brand.aliases.length} aliases` : null;
  const tags = brand.tags?.length ? `${brand.tags.length} tags` : null;

  return [aliases, tags].filter(Boolean).join(" • ") || "Brand reference";
}

function formatObservedRange(minPrice: number, maxPrice: number, currency: string) {
  return `${formatCurrencyAmount(minPrice, currency)} to ${formatCurrencyAmount(maxPrice, currency)}`;
}

export function getProviderAvailabilityMessage(
  providers: SearchProviderSummary[] | undefined,
  surface: "feed" | "search",
) {
  if (!providers?.length) {
    return undefined;
  }

  const failedProviders = providers.filter((provider) => provider.status === "failure");
  const staleProviders = providers.filter(
    (provider) =>
      provider.status === "success" &&
      (provider.freshness === "stale" || provider.cacheStatus === "stale"),
  );
  const degradedProviders = providers.filter(
    (provider) => provider.status === "success" && provider.degraded,
  );
  const actionLabel = surface === "feed" ? "while loading the feed" : "during this search";

  if (failedProviders.length > 0) {
    if (failedProviders.length === 1) {
      const failedProvider = failedProviders[0];
      const reason =
        failedProvider?.failure?.code === "rate_limited" ? "was rate limited" : "was unavailable";

      return `Partial results: ${failedProvider?.providerName} ${reason} ${actionLabel}. You can retry without losing successful results.`;
    }

    return `Partial results: ${failedProviders.length} marketplaces were unavailable ${actionLabel}. Successful marketplace results are still shown.`;
  }

  if (staleProviders.length > 0) {
    return `Showing cached data from ${staleProviders.map((provider) => provider.providerName).join(", ")} while fresh marketplace data is unavailable.`;
  }

  if (degradedProviders.length > 0) {
    return `Results are limited by current ${degradedProviders.map((provider) => provider.providerName).join(", ")} capabilities.`;
  }

  return undefined;
}

function getSearchEmptyStateMessage(query: string, providers: SearchProviderSummary[] | undefined) {
  const providerAvailabilityMessage = getProviderAvailabilityMessage(providers, "search");
  const baseMessage =
    query.trim().length > 0
      ? `No results found for "${query}". Try broadening your search or clearing a filter.`
      : "No results found for these filters. Try broadening your search or clearing a filter.";

  return providerAvailabilityMessage
    ? `${baseMessage} ${providerAvailabilityMessage}`
    : baseMessage;
}

function formatCurrencyAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function hasCompletedOnboarding(session: AuthResponse | null) {
  const preferences = session?.user.onboardingPreferences;

  if (!preferences) {
    return false;
  }

  return (
    preferences.favoriteBrands.length > 0 ||
    preferences.categories.length > 0 ||
    preferences.priceRange.trim().length > 0
  );
}

export function getHomeFeedPresentation(
  session: AuthResponse | null,
  summary?: PersonalizationSummary,
) {
  if (!session) {
    return {
      chipLabel: "Trending",
      introCopy: "Popular finds across resale marketplaces.",
    };
  }

  if (summary?.isPersonalized) {
    return {
      chipLabel: "For You",
      introCopy: summary.message,
    };
  }

  return {
    chipLabel: "Fresh Picks",
    introCopy: summary?.message ?? "Like listings or save a search to personalize this feed.",
  };
}

function createEmptyWatchlistForm(currency = "USD"): WatchlistFormState {
  return {
    brand: "",
    category: "",
    condition: "",
    enabled: true,
    label: "",
    listingType: "",
    maxPriceAmount: "",
    minPriceAmount: "",
    priceCurrency: currency,
    queryText: "",
    size: "",
    source: "",
  };
}

function createWatchlistFormFromWatchlist(
  watchlist: Watchlist,
  fallbackCurrency = "USD",
): WatchlistFormState {
  return {
    brand: watchlist.brand ?? "",
    category: watchlist.category ?? "",
    condition: watchlist.condition ?? "",
    enabled: watchlist.enabled,
    label: watchlist.label,
    listingType: watchlist.listingType ?? "",
    maxPriceAmount: watchlist.maxPriceAmount !== undefined ? String(watchlist.maxPriceAmount) : "",
    minPriceAmount: watchlist.minPriceAmount !== undefined ? String(watchlist.minPriceAmount) : "",
    priceCurrency: watchlist.priceCurrency ?? fallbackCurrency,
    queryText: watchlist.queryText ?? "",
    size: watchlist.size ?? "",
    source: watchlist.source ?? "",
  };
}

export function createWatchlistDraftFromSearch(
  values: SearchFormValues,
  currency = "USD",
): WatchlistFormState {
  return {
    ...createEmptyWatchlistForm(currency),
    brand: values.brand?.trim() ?? "",
    category: values.category?.trim() ?? "",
    condition: values.condition ?? "",
    listingType: values.listingType,
    maxPriceAmount: values.maxPrice,
    minPriceAmount: values.minPrice,
    priceCurrency: values.currency?.trim() || currency,
    queryText: values.query.trim(),
    size: values.size?.trim() ?? "",
    source: values.source.trim(),
  };
}

function buildWatchlistPayload(form: WatchlistFormState) {
  return {
    brand: form.brand.trim() || undefined,
    category: form.category.trim() || undefined,
    condition: form.condition || undefined,
    enabled: form.enabled,
    label: form.label.trim() || undefined,
    listingType: form.listingType || undefined,
    maxPriceAmount: form.maxPriceAmount ? Number(form.maxPriceAmount) : undefined,
    minPriceAmount: form.minPriceAmount ? Number(form.minPriceAmount) : undefined,
    priceCurrency: form.priceCurrency.trim() || undefined,
    queryText: form.queryText.trim() || undefined,
    size: form.size.trim() || undefined,
    source: form.source.trim() || undefined,
  };
}

export function buildWatchlistPayloadFromSearch(values: SearchFormValues, currency = "USD") {
  return buildWatchlistPayload(createWatchlistDraftFromSearch(values, currency));
}

function formatConditionLabel(condition?: string) {
  if (!condition) {
    return undefined;
  }

  return condition
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildSavedSearchLabel(values: SearchFormValues) {
  return values.query.trim() || "Saved search";
}

function buildSavedFilterLabel(values: SearchFormValues) {
  const query = values.query.trim();

  if (query.length > 0) {
    return `${query} preset`;
  }

  if (values.source.trim().length > 0) {
    return `${values.source.trim()} preset`;
  }

  if (values.listingType === "auction") {
    return "Auction preset";
  }

  if (values.listingType === "buy_now") {
    return "Fixed price preset";
  }

  return "Saved filter";
}

function createSavedFilterValues(savedFilter: SavedFilter): SearchFormValues {
  return {
    query: savedFilter.queryText ?? "",
    sort: savedFilter.sortMode ?? "relevance",
    source: savedFilter.source ?? "",
    listingType: savedFilter.listingType ?? "",
    minPrice: savedFilter.minPrice !== undefined ? String(savedFilter.minPrice) : "",
    maxPrice: savedFilter.maxPrice !== undefined ? String(savedFilter.maxPrice) : "",
  };
}

function summarizeOnboardingPreferences(session: AuthResponse) {
  const preferences = session.user.onboardingPreferences;
  const favoriteBrands = preferences.favoriteBrands.join(", ") || "None yet";
  const categories = preferences.categories.join(", ") || "None yet";
  const priceRange = preferences.priceRange.trim() || "No price range yet";

  return {
    favoriteBrands,
    categories,
    priceRange,
  };
}

function formatFilterSummary(savedFilter: SavedFilter, currency: string) {
  return (
    describeSearch(createSavedFilterValues(savedFilter)) +
    (currency ? ` • Prefers ${currency}` : "")
  );
}

function formatWatchlistSummary(watchlist: Watchlist, currency: string) {
  const details = [
    watchlist.queryText,
    watchlist.brand,
    watchlist.category,
    watchlist.source,
    watchlist.listingType === "auction"
      ? "Auction"
      : watchlist.listingType === "buy_now"
        ? "Fixed price"
        : undefined,
    watchlist.size ? `Size ${watchlist.size}` : undefined,
    formatConditionLabel(watchlist.condition),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  if (watchlist.minPriceAmount !== undefined) {
    details.push(
      `From ${formatCurrencyAmount(watchlist.minPriceAmount, watchlist.priceCurrency ?? currency)}`,
    );
  }

  if (watchlist.maxPriceAmount !== undefined) {
    details.push(
      `Up to ${formatCurrencyAmount(watchlist.maxPriceAmount, watchlist.priceCurrency ?? currency)}`,
    );
  }

  if (!watchlist.enabled) {
    details.push("Paused");
  }

  return details.join(" • ") || "Watching for future matches.";
}

type SearchInteractionSurface =
  "global_search" | "profile_saved_filter" | "profile_saved_search" | "search_page";

function getActiveSearchFilterNames(values: SearchFormValues) {
  const activeFilters: string[] = [];

  if (values.brand?.trim()) activeFilters.push("brand");
  if (values.category?.trim()) activeFilters.push("category");
  if (values.condition) activeFilters.push("condition");
  if (values.currency?.trim()) activeFilters.push("currency");
  if (values.listingType) activeFilters.push("listingType");
  if (values.marketStatus) activeFilters.push("marketStatus");
  if (values.maxPrice.trim()) activeFilters.push("maxPrice");
  if (values.minPrice.trim()) activeFilters.push("minPrice");
  if (values.size?.trim()) activeFilters.push("size");
  if (values.sort !== "relevance") activeFilters.push("sort");
  if (values.source.trim()) activeFilters.push("source");

  return activeFilters;
}

function recordSearchInteraction(
  values: SearchFormValues,
  surface: SearchInteractionSurface,
  intent: "clear" | "submit" = "submit",
  clearedValues?: SearchFormValues,
) {
  const valuesForFilters = clearedValues ?? values;
  const activeFilters = getActiveSearchFilterNames(valuesForFilters);

  if (intent === "submit") {
    void recordEngagementEvent({
      eventType: "search_submit",
      properties: {
        filterCount: activeFilters.length,
        surface,
      },
      searchQuery: values.query.trim() || undefined,
    });
  }

  if (activeFilters.length > 0 || intent === "clear") {
    void recordEngagementEvent({
      eventType: "filter_apply",
      properties: {
        action: intent,
        activeFilters,
        filterCount: activeFilters.length,
        surface,
      },
    });
  }
}

function useLikes(session: AuthResponse | null, onAuthFailure: () => void) {
  const userId = session?.userId;
  const [likes, setLikes] = useState<Like[]>([]);
  const [likedListings, setLikedListings] = useState<LikedListing[]>([]);

  useEffect(() => {
    if (!userId) {
      setLikes([]);
      setLikedListings([]);
      return;
    }

    const controller = new AbortController();

    void fetchJson<LikesResponse>("/me/likes", controller.signal)
      .then((response) => {
        setLikes(response.likes);
        setLikedListings(response.likedListings);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (isAuthRequiredError(error)) {
            onAuthFailure();
          }
          setLikes([]);
          setLikedListings([]);
        }
      });

    return () => {
      controller.abort();
    };
  }, [onAuthFailure, userId]);

  async function toggleLike(
    listing: Listing,
    nextLiked: boolean,
    surface: ListingCardEngagementContext["surface"] | "unknown" = "unknown",
  ) {
    if (!userId) {
      return;
    }

    if (nextLiked) {
      const optimisticLike: Like = {
        id: `optimistic-${listing.id}`,
        userId,
        listingId: listing.id,
        source: listing.source.id,
        createdAt: new Date().toISOString(),
      };
      const optimisticLikedListing: LikedListing = {
        like: optimisticLike,
        listing,
        snapshotStatus: "snapshot",
      };

      setLikes((currentLikes) => {
        if (currentLikes.some((like) => like.listingId === listing.id)) {
          return currentLikes;
        }

        return [optimisticLike, ...currentLikes];
      });
      setLikedListings((currentLikedListings) => {
        if (currentLikedListings.some((entry) => entry.like.listingId === listing.id)) {
          return currentLikedListings;
        }

        return [optimisticLikedListing, ...currentLikedListings];
      });

      try {
        const response = await sendJson<LikeMutationResponse>("/me/likes", "POST", {
          listingId: listing.id,
          source: listing.source.id,
          listing,
        });

        setLikes((currentLikes) => {
          const remainingLikes = currentLikes.filter(
            (like) => like.listingId !== response.likedListing.like.listingId,
          );

          return [response.likedListing.like, ...remainingLikes];
        });
        setLikedListings((currentLikedListings) => {
          const remainingLikedListings = currentLikedListings.filter(
            (entry) => entry.like.listingId !== response.likedListing.like.listingId,
          );

          return [response.likedListing, ...remainingLikedListings];
        });

        if (isListingEngagementEligible(listing)) {
          void recordEngagementEvent({
            eventType: "like",
            listingId: listing.id,
            properties: {
              providerId: listing.providerId,
              surface,
            },
          });
        }
      } catch (error) {
        if (isAuthRequiredError(error)) {
          onAuthFailure();
        }
        setLikes((currentLikes) => currentLikes.filter((like) => like.listingId !== listing.id));
        setLikedListings((currentLikedListings) =>
          currentLikedListings.filter((entry) => entry.like.listingId !== listing.id),
        );
        throw error;
      }

      return;
    }

    const existingLike = likes.find((like) => like.listingId === listing.id);
    const existingLikedListing = likedListings.find((entry) => entry.like.listingId === listing.id);

    setLikes((currentLikes) => currentLikes.filter((like) => like.listingId !== listing.id));
    setLikedListings((currentLikedListings) =>
      currentLikedListings.filter((entry) => entry.like.listingId !== listing.id),
    );

    try {
      await sendJson<{ removed: boolean }>("/me/likes", "DELETE", {
        listingId: listing.id,
      });

      if (isListingEngagementEligible(listing)) {
        void recordEngagementEvent({
          eventType: "unlike",
          listingId: listing.id,
          properties: {
            providerId: listing.providerId,
            surface,
          },
        });
      }
    } catch (error) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
      }

      if (existingLike) {
        setLikes((currentLikes) => {
          if (currentLikes.some((like) => like.listingId === existingLike.listingId)) {
            return currentLikes;
          }

          return [existingLike, ...currentLikes];
        });
      }

      if (existingLikedListing) {
        setLikedListings((currentLikedListings) => {
          if (
            currentLikedListings.some(
              (entry) => entry.like.listingId === existingLikedListing.like.listingId,
            )
          ) {
            return currentLikedListings;
          }

          return [existingLikedListing, ...currentLikedListings];
        });
      }

      throw error;
    }
  }

  return {
    likes,
    likedListingIds: new Set(likes.map((like) => like.listingId)),
    likedListings,
    toggleLike,
  };
}

function ListingGrid({
  engagement,
  listings,
  likedListingIds,
  onToggleLike,
}: {
  engagement: Omit<ListingCardEngagementContext, "rankedPosition">;
  listings: Listing[];
  likedListingIds?: Set<string>;
  onToggleLike?: (listing: Listing, nextLiked: boolean) => Promise<void>;
}) {
  return (
    <div className="listing-grid">
      {listings.map((listing, index) => (
        <ListingCard
          engagement={{
            ...engagement,
            rankedPosition: index,
          }}
          key={listing.id}
          isLiked={likedListingIds?.has(listing.id)}
          listing={listing}
          onToggleLike={onToggleLike}
        />
      ))}
    </div>
  );
}

function GlobalSearchBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentQuery = parseSearchFormValues(new URLSearchParams(location.search)).query;
  const [query, setQuery] = useState(currentQuery);

  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValues = {
      ...createDefaultSearchFormValues(),
      query,
    };

    recordSearchInteraction(nextValues, "global_search");

    startTransition(() => {
      navigate(buildSearchPath(nextValues));
    });
  }

  return (
    <form className="global-search" onSubmit={handleSubmit}>
      <label className="global-search__label" htmlFor="global-search-input">
        Search
      </label>
      <div className="global-search__controls">
        <input
          className="global-search__input"
          id="global-search-input"
          name="q"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search brands, pieces, or styles"
          value={query}
        />
        <button className="global-search__button" type="submit">
          Explore
        </button>
      </div>
    </form>
  );
}

function LoadingListings({ count = 8 }: { count?: number }) {
  return (
    <div className="listing-grid listing-grid--loading" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <article key={index} className="listing-card listing-card--placeholder">
          <div className="listing-card__image-wrap" />
          <div className="listing-card__body">
            <div className="skeleton-line skeleton-line--short" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line--price" />
          </div>
        </article>
      ))}
    </div>
  );
}

function HomePage({
  onAuthFailure,
  session,
}: {
  onAuthFailure: () => void;
  session: AuthResponse | null;
}) {
  const navigate = useNavigate();
  const { likedListingIds, toggleLike } = useLikes(session, onAuthFailure);
  const [reloadCount, setReloadCount] = useState(0);
  const needsPreferenceReminder = Boolean(session) && !hasCompletedOnboarding(session);
  const [state, setState] = useState<FeedRequestState>({
    isLoadingMore: false,
    isPersonalized: false,
    listings: [],
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    const feedParams = new URLSearchParams({
      page: "1",
      pageSize: String(homeFeedPageSize),
    });
    let engagementRequestId: string | undefined;

    try {
      engagementRequestId = createEngagementId();
      void recordEngagementEvent({
        eventType: "recommendation_request",
        properties: {
          pageSize: homeFeedPageSize,
          personalizationRequested: Boolean(session?.userId),
          surface: "home_feed",
        },
        requestId: engagementRequestId,
      });
    } catch {
      // Recommendation telemetry must never prevent the feed request.
    }

    setState({
      engagementRequestId,
      isLoadingMore: false,
      isPersonalized: false,
      listings: [],
      status: "loading",
    });

    void fetchJson<FeedResponse>("/feed?" + feedParams.toString(), controller.signal)
      .then((response) => {
        setState({
          engagementRequestId,
          isLoadingMore: false,
          isPersonalized: response.isPersonalized,
          listings: response.listings,
          pagination: response.pagination,
          personalizationSummary: response.personalizationSummary,
          providers: response.providers,
          status: "success",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          errorMessage: error instanceof Error ? error.message : "The feed request failed.",
          isLoadingMore: false,
          isPersonalized: false,
          listings: [],
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [reloadCount, session?.userId]);

  function handleRetry() {
    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  function handleLoadMore() {
    if (!state.pagination?.hasMore || state.isLoadingMore) {
      return;
    }

    const feedParams = new URLSearchParams({
      pageSize: String(homeFeedPageSize),
    });

    if (state.pagination.nextCursor) {
      feedParams.set("cursor", state.pagination.nextCursor);
    } else if (state.pagination.nextPage) {
      feedParams.set("page", String(state.pagination.nextPage));
    }

    setState((currentState) => ({
      ...currentState,
      isLoadingMore: true,
      loadMoreErrorMessage: undefined,
    }));

    void fetchJson<FeedResponse>("/feed?" + feedParams.toString())
      .then((response) => {
        setState((currentState) => ({
          ...currentState,
          isLoadingMore: false,
          isPersonalized: response.isPersonalized,
          listings: mergeUniqueListings(currentState.listings, response.listings),
          loadMoreErrorMessage: undefined,
          pagination: response.pagination,
          personalizationSummary:
            response.personalizationSummary ?? currentState.personalizationSummary,
          providers: response.providers,
          status: "success",
        }));
      })
      .catch((error: unknown) => {
        setState((currentState) => ({
          ...currentState,
          isLoadingMore: false,
          loadMoreErrorMessage:
            error instanceof Error ? error.message : "The next page could not be loaded.",
        }));
      });
  }

  async function handleToggleLike(listing: Listing, nextLiked: boolean) {
    if (!session) {
      startTransition(() => {
        navigate("/login");
      });
      return;
    }

    await toggleLike(listing, nextLiked, "home_feed");

    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  const presentation = getHomeFeedPresentation(session, state.personalizationSummary);
  const listingCount = state.pagination?.totalCount ?? state.listings.length;
  const showLowSignalPrompt =
    Boolean(session) &&
    state.status === "success" &&
    !state.isPersonalized &&
    !needsPreferenceReminder;
  const providerAvailabilityMessage = getProviderAvailabilityMessage(state.providers, "feed");

  return (
    <section className="page-shell page-shell--home">
      <header className="market-header">
        <div>
          <h1>Find your next piece</h1>
          <p className="page-description">{presentation.introCopy}</p>
        </div>
        <div className="chip-row chip-row--tabs">
          <span className="info-chip info-chip--accent">{presentation.chipLabel}</span>
          <span className="info-chip">New Finds</span>
          <span className="info-chip">
            {listingCount > 0 ? String(listingCount) + " listings" : "Fresh updates"}
          </span>
        </div>
      </header>

      {needsPreferenceReminder ? (
        <section className="inline-banner">
          <p>Choose brands and categories to shape your feed.</p>
          <Link className="secondary-button link-button" to="/onboarding">
            Update preferences
          </Link>
        </section>
      ) : null}

      {showLowSignalPrompt ? (
        <section className="inline-banner">
          <p>Like listings or save a search to make this feed more personal.</p>
          <Link className="secondary-button link-button" to="/search">
            Explore search
          </Link>
        </section>
      ) : null}

      {providerAvailabilityMessage ? (
        <section className="inline-banner">
          <p>{providerAvailabilityMessage}</p>
        </section>
      ) : null}

      {state.status === "loading" ? <LoadingListings count={homeFeedPageSize} /> : null}

      {state.status === "error" ? (
        <StateCard
          action={
            <button className="secondary-button" onClick={handleRetry} type="button">
              Try again
            </button>
          }
          body={state.errorMessage ?? "The feed request could not be completed."}
          title="Feed unavailable"
        />
      ) : null}

      {state.status === "success" && state.listings.length === 0 ? (
        <StateCard
          body={
            session
              ? providerAvailabilityMessage
                ? `There is nothing to show right now. ${providerAvailabilityMessage}`
                : "There is nothing to show right now. Save a few likes or come back when new listings arrive."
              : providerAvailabilityMessage
                ? `There are no listings to show right now. ${providerAvailabilityMessage}`
                : "There are no listings to show right now. Check back soon for fresh finds."
          }
          title="Nothing here yet"
        />
      ) : null}

      {state.status === "success" && state.listings.length > 0 ? (
        <>
          <ListingGrid
            engagement={{
              recommendationRequestId: state.engagementRequestId,
              surface: "home_feed",
              viewContextId: "home_feed",
            }}
            likedListingIds={likedListingIds}
            listings={state.listings}
            onToggleLike={handleToggleLike}
          />
          {state.loadMoreErrorMessage ? (
            <StateCard
              action={
                <button className="secondary-button" onClick={handleLoadMore} type="button">
                  Retry load more
                </button>
              }
              body={state.loadMoreErrorMessage}
              title="Could not load more listings"
            />
          ) : null}
          <InfiniteScrollSentinel
            hasMore={Boolean(state.pagination?.hasMore)}
            isLoading={state.isLoadingMore}
            label="more feed listings"
            onLoadMore={handleLoadMore}
          />
          <div className="feed-results__footer">
            {state.pagination?.hasMore ? (
              <button
                className="load-more-button"
                disabled={state.isLoadingMore}
                onClick={handleLoadMore}
                type="button"
              >
                {state.isLoadingMore ? "Loading more..." : "Load more"}
              </button>
            ) : (
              <p className="page-description">You are caught up for now.</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SearchPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate title="Search" description="Search brands, pieces, and styles.">
      {children}
    </PageTemplate>
  );
}

function RecentSearchesPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      title="Recent Searches"
      description="Jump back into the searches you ran most recently."
    >
      {children}
    </PageTemplate>
  );
}

function AnalyticsPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      title="Premium Analytics"
      description="Observed-data pricing context only. No predictions, profit claims, or guaranteed underpriced calls."
    >
      {children}
    </PageTemplate>
  );
}

function ProfilePage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate title="Profile" description="Your account, preferences, and saved pieces.">
      {children}
    </PageTemplate>
  );
}

function BetaInfoPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      title="Beta Information"
      description="Privacy, data use, limits, and feedback guidance for the constrained ClosetSearch beta."
    >
      {children}
    </PageTemplate>
  );
}

function BrandsPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate title="Brands" description="Browse labels, aliases, and style tags.">
      {children}
    </PageTemplate>
  );
}

function BrandDetailPage({ brandName, children }: { brandName?: string; children?: ReactNode }) {
  return (
    <PageTemplate
      title={brandName ?? "Brand Profile"}
      description="Explore the brand, then jump straight into listings."
    >
      {children}
    </PageTemplate>
  );
}

function AuthPage({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <PageTemplate title={title} description={description}>
      <section className="auth-shell">{children}</section>
    </PageTemplate>
  );
}

function OnboardingPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      title="Tell us what you like"
      description="Choose brands and categories to shape your feed."
    >
      <section className="auth-shell">{children}</section>
    </PageTemplate>
  );
}

function NotFoundPage() {
  return (
    <PageTemplate
      title="Page not found"
      description="That page does not exist. Try home, search, or brands."
    />
  );
}

function SearchControlPanel({
  initialValues,
  marketplaceOptions,
  onSubmit,
  secondaryActions,
}: {
  initialValues: SearchFormValues;
  marketplaceOptions: Array<{ label: string; value: string }>;
  onSubmit: (
    values: SearchFormValues,
    intent: "clear" | "submit",
    previousValues?: SearchFormValues,
  ) => void;
  secondaryActions?: ReactNode;
}) {
  const [values, setValues] = useState(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [
    initialValues.brand,
    initialValues.category,
    initialValues.condition,
    initialValues.currency,
    initialValues.listingType,
    initialValues.marketStatus,
    initialValues.maxPrice,
    initialValues.minPrice,
    initialValues.query,
    initialValues.size,
    initialValues.sort,
    initialValues.source,
  ]);

  function updateValue<Key extends keyof SearchFormValues>(key: Key, value: SearchFormValues[Key]) {
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(values, "submit");
  }

  function handleClear() {
    const nextValues = createDefaultSearchFormValues();
    setValues(nextValues);
    onSubmit(nextValues, "clear", values);
  }

  return (
    <form className="search-panel" onSubmit={handleSubmit}>
      <div className="search-panel__header">
        <div>
          <h2>Search the marketplace</h2>
          <p>
            Search brands, pieces, and styles, then narrow the results with a few quick filters.
          </p>
        </div>
        <Link className="secondary-button link-button" to="/recent-searches">
          Recent searches
        </Link>
      </div>

      <div className="search-panel__grid">
        <label className="field-group field-group--wide" htmlFor="search-page-query">
          <span>Search</span>
          <input
            id="search-page-query"
            onChange={(event) => updateValue("query", event.target.value)}
            placeholder="Search brands, pieces, or styles"
            value={values.query}
          />
        </label>

        <label className="field-group" htmlFor="search-page-source">
          <span>Marketplace</span>
          <select
            id="search-page-source"
            onChange={(event) => updateValue("source", event.target.value)}
            value={values.source}
          >
            {marketplaceOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-group" htmlFor="search-page-listing-type">
          <span>Type</span>
          <select
            id="search-page-listing-type"
            onChange={(event) =>
              updateValue("listingType", event.target.value as SearchFormValues["listingType"])
            }
            value={values.listingType}
          >
            {listingTypeOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-group" htmlFor="search-page-brand">
          <span>Brand</span>
          <input
            id="search-page-brand"
            onChange={(event) => updateValue("brand", event.target.value)}
            placeholder="Rick Owens"
            value={values.brand ?? ""}
          />
        </label>

        <label className="field-group" htmlFor="search-page-category">
          <span>Category</span>
          <input
            id="search-page-category"
            onChange={(event) => updateValue("category", event.target.value)}
            placeholder="Jackets"
            value={values.category ?? ""}
          />
        </label>

        <label className="field-group" htmlFor="search-page-size">
          <span>Size</span>
          <input
            id="search-page-size"
            onChange={(event) => updateValue("size", event.target.value)}
            placeholder="M, 32, 44"
            value={values.size ?? ""}
          />
        </label>

        <label className="field-group" htmlFor="search-page-condition">
          <span>Condition</span>
          <select
            id="search-page-condition"
            onChange={(event) =>
              updateValue("condition", event.target.value as SearchFormValues["condition"])
            }
            value={values.condition ?? ""}
          >
            {conditionOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-group" htmlFor="search-page-status">
          <span>Market status</span>
          <select
            id="search-page-status"
            onChange={(event) =>
              updateValue("marketStatus", event.target.value as SearchFormValues["marketStatus"])
            }
            value={values.marketStatus ?? ""}
          >
            {marketStatusOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-group" htmlFor="search-page-sort">
          <span>Sort</span>
          <select
            id="search-page-sort"
            onChange={(event) => updateValue("sort", event.target.value as SearchSortMode)}
            value={values.sort}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-group" htmlFor="search-page-currency">
          <span>Comparison currency</span>
          <select
            id="search-page-currency"
            onChange={(event) => updateValue("currency", event.target.value)}
            value={values.currency ?? ""}
          >
            {currencyOptions.map((currency) => (
              <option key={currency || "original"} value={currency}>
                {currency || "Original currency"}
              </option>
            ))}
          </select>
        </label>

        <label className="field-group" htmlFor="search-page-min-price">
          <span>Min price</span>
          <input
            id="search-page-min-price"
            inputMode="numeric"
            min="0"
            onChange={(event) => updateValue("minPrice", event.target.value)}
            placeholder="0"
            type="number"
            value={values.minPrice}
          />
        </label>

        <label className="field-group" htmlFor="search-page-max-price">
          <span>Max price</span>
          <input
            id="search-page-max-price"
            inputMode="numeric"
            min="0"
            onChange={(event) => updateValue("maxPrice", event.target.value)}
            placeholder="500"
            type="number"
            value={values.maxPrice}
          />
        </label>
      </div>

      <div className="search-panel__actions">
        <button className="search-form__button" type="submit">
          Explore results
        </button>
        <button className="secondary-button" onClick={handleClear} type="button">
          Clear filters
        </button>
      </div>

      {secondaryActions ? <div className="state-card__action">{secondaryActions}</div> : null}
    </form>
  );
}

function SearchResults({
  likedListingIds,
  onLoadMore,
  onRetry,
  onToggleLike,
  query,
  state,
  summary,
  viewContextId,
}: {
  likedListingIds: Set<string>;
  onLoadMore: () => void;
  onRetry: () => void;
  onToggleLike: (listing: Listing, nextLiked: boolean) => Promise<void>;
  query: string;
  state: SearchRequestState;
  summary: string;
  viewContextId: string;
}) {
  if (state.status === "idle") {
    return (
      <StateCard body="Start with a search to see listings here." title="Search the marketplace" />
    );
  }

  if (state.status === "loading") {
    return <LoadingListings count={searchResultsPageSize} />;
  }

  if (state.status === "error") {
    return (
      <StateCard
        action={
          <button className="secondary-button" onClick={onRetry} type="button">
            Try again
          </button>
        }
        body={state.errorMessage ?? "The search request could not be completed."}
        title="Search unavailable"
      />
    );
  }

  const response = state.response;
  const providerAvailabilityMessage = getProviderAvailabilityMessage(response?.providers, "search");

  if (!response || response.listings.length === 0) {
    return (
      <StateCard
        body={getSearchEmptyStateMessage(query, response?.providers)}
        title="No results found"
      />
    );
  }

  const listingCount = response.pagination.totalCount ?? response.listings.length;
  const resultsLabel =
    response.query.text.trim().length > 0
      ? 'Results for "' + response.query.text + '".'
      : "Results for your active filters.";

  return (
    <section className="search-results">
      <div className="section-heading">
        <div>
          <h2>{listingCount} listings</h2>
          <p>{resultsLabel}</p>
        </div>
        <div className="chip-row">
          <span className="info-chip">{summary}</span>
          <span className="info-chip">
            {response.providers.map((provider) => provider.providerName).join(", ")}
          </span>
        </div>
      </div>

      {providerAvailabilityMessage ? (
        <section className="inline-banner">
          <p>{providerAvailabilityMessage}</p>
        </section>
      ) : null}

      <ListingGrid
        engagement={{
          surface: "search_results",
          viewContextId,
        }}
        likedListingIds={likedListingIds}
        listings={response.listings}
        onToggleLike={onToggleLike}
      />

      {state.loadMoreErrorMessage ? (
        <StateCard
          action={
            <button className="secondary-button" onClick={onLoadMore} type="button">
              Retry load more
            </button>
          }
          body={state.loadMoreErrorMessage}
          title="Could not load more results"
        />
      ) : null}

      <InfiniteScrollSentinel
        hasMore={response.pagination.hasMore}
        isLoading={state.isLoadingMore}
        label="more search results"
        onLoadMore={onLoadMore}
      />
      <div className="feed-results__footer">
        {response.pagination.hasMore ? (
          <button
            className="load-more-button"
            disabled={state.isLoadingMore}
            onClick={onLoadMore}
            type="button"
          >
            {state.isLoadingMore ? "Loading more..." : "Load more"}
          </button>
        ) : (
          <p className="page-description">End of results for this search.</p>
        )}
      </div>
    </section>
  );
}

function SearchRoutePage({
  onAuthFailure,
  session,
}: {
  onAuthFailure: () => void;
  session: AuthResponse | null;
}) {
  const navigate = useNavigate();
  const { likedListingIds, toggleLike } = useLikes(session, onAuthFailure);
  const [searchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const values = parseSearchFormValues(searchParams);
  const hasActiveSearch = hasActiveSearchValues(values);
  const query = values.query;
  const [reloadCount, setReloadCount] = useState(0);
  const marketplaceOptions = useMarketplaceOptions();
  const [saveFeedback, setSaveFeedback] = useState<string | undefined>();
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | undefined>();
  const [savingAction, setSavingAction] = useState<"search" | "filters" | "watchlist" | null>(null);
  const [state, setState] = useState<SearchRequestState>({
    isLoadingMore: false,
    status: hasActiveSearch ? "loading" : "idle",
  });

  useEffect(() => {
    setSaveFeedback(undefined);
    setSaveErrorMessage(undefined);
  }, [searchKey, session?.userId]);

  useEffect(() => {
    if (!hasActiveSearch) {
      setState({ isLoadingMore: false, status: "idle" });
      return;
    }

    const controller = new AbortController();
    const requestParams = createSearchParams(values);
    requestParams.set("pageSize", String(searchResultsPageSize));

    setState({ isLoadingMore: false, status: "loading" });

    void fetchJson<SearchResponse>("/search?" + requestParams.toString(), controller.signal)
      .then((response) => {
        setState({
          isLoadingMore: false,
          response,
          status: "success",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          errorMessage: error instanceof Error ? error.message : "Search request failed.",
          isLoadingMore: false,
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [hasActiveSearch, reloadCount, searchKey]);

  useEffect(() => {
    if (
      state.status !== "success" ||
      state.isLoadingMore ||
      query.length === 0 ||
      state.response?.pagination.page !== 1
    ) {
      return;
    }

    const entry = createRecentSearchEntry(values);

    if (!entry) {
      return;
    }

    if (!session?.userId) {
      saveRecentSearch(values);
      return;
    }

    void sendJson<RecentSearchesResponse>("/recent-searches", "POST", {
      label: entry.label,
      description: entry.description,
      params: entry.params,
    }).catch((error: unknown) => {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        saveRecentSearch(values);
      }

      return undefined;
    });
  }, [
    onAuthFailure,
    query,
    searchKey,
    session?.userId,
    state.isLoadingMore,
    state.response?.pagination.page,
    state.status,
  ]);

  function handleSubmit(
    nextValues: SearchFormValues,
    intent: "clear" | "submit",
    previousValues?: SearchFormValues,
  ) {
    recordSearchInteraction(nextValues, "search_page", intent, previousValues);

    startTransition(() => {
      navigate(buildSearchPath(nextValues));
    });
  }

  function handleRetry() {
    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  function handleLoadMore() {
    if (!state.response?.pagination.hasMore || state.isLoadingMore) {
      return;
    }

    const requestParams = createSearchParams(values);
    requestParams.set("pageSize", String(searchResultsPageSize));

    if (state.response.pagination.nextCursor) {
      requestParams.set("cursor", state.response.pagination.nextCursor);
    } else if (state.response.pagination.nextPage) {
      requestParams.set("page", String(state.response.pagination.nextPage));
    }

    setState((currentState) => ({
      ...currentState,
      isLoadingMore: true,
      loadMoreErrorMessage: undefined,
    }));

    void fetchJson<SearchResponse>("/search?" + requestParams.toString())
      .then((response) => {
        setState((currentState) => ({
          isLoadingMore: false,
          loadMoreErrorMessage: undefined,
          response: currentState.response
            ? {
                ...response,
                listings: mergeUniqueListings(currentState.response.listings, response.listings),
              }
            : response,
          status: "success",
        }));
      })
      .catch((error: unknown) => {
        setState((currentState) => ({
          ...currentState,
          isLoadingMore: false,
          loadMoreErrorMessage:
            error instanceof Error ? error.message : "The next page could not be loaded.",
        }));
      });
  }

  async function handleToggleLike(listing: Listing, nextLiked: boolean) {
    if (!session) {
      startTransition(() => {
        navigate("/login");
      });
      return;
    }

    await toggleLike(listing, nextLiked, "search_results");
  }

  async function handleSaveSearch() {
    if (!hasActiveSearch) {
      return;
    }

    if (!session) {
      setSaveFeedback("Log in to save searches and filter presets.");
      setSaveErrorMessage(undefined);
      return;
    }

    setSavingAction("search");
    setSaveFeedback(undefined);
    setSaveErrorMessage(undefined);

    try {
      await sendJson<SavedSearchesResponse>("/me/saved-searches", "POST", {
        label: buildSavedSearchLabel(values),
        description: describeSearch(values),
        params: createSearchParams(values).toString(),
      });
      void recordEngagementEvent({
        eventType: "saved_search",
        properties: {
          filterCount: getActiveSearchFilterNames(values).length,
          surface: "search_page",
        },
        searchQuery: values.query.trim() || undefined,
      });
      setSaveFeedback("Saved this search to your profile.");
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
      }
      setSaveErrorMessage(
        error instanceof Error ? error.message : "The search could not be saved.",
      );
    } finally {
      setSavingAction(null);
    }
  }

  async function handleSaveFilters() {
    if (!hasActiveSearch) {
      return;
    }

    if (!session) {
      setSaveFeedback("Log in to save searches and filter presets.");
      setSaveErrorMessage(undefined);
      return;
    }

    setSavingAction("filters");
    setSaveFeedback(undefined);
    setSaveErrorMessage(undefined);

    try {
      await sendJson<SavedFiltersResponse>("/me/saved-filters", "POST", {
        label: buildSavedFilterLabel(values),
        queryText: values.query.trim() || undefined,
        source: values.source.trim() || undefined,
        listingType: values.listingType || undefined,
        minPrice: values.minPrice ? Number(values.minPrice) : undefined,
        maxPrice: values.maxPrice ? Number(values.maxPrice) : undefined,
        sortMode: values.sort,
      });
      void recordEngagementEvent({
        eventType: "saved_filter",
        properties: {
          filterCount: getActiveSearchFilterNames(values).length,
          surface: "search_page",
        },
      });
      setSaveFeedback("Saved this filter preset to your profile.");
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
      }
      setSaveErrorMessage(
        error instanceof Error ? error.message : "The filters could not be saved.",
      );
    } finally {
      setSavingAction(null);
    }
  }

  async function handleCreateWatchlistFromSearch() {
    if (!hasActiveSearch) {
      return;
    }

    if (!session) {
      setSaveFeedback("Log in to save searches, filters, and watchlists.");
      setSaveErrorMessage(undefined);
      return;
    }

    setSavingAction("watchlist");
    setSaveFeedback(undefined);
    setSaveErrorMessage(undefined);

    try {
      await sendJson<WatchlistsResponse>(
        "/me/watchlists",
        "POST",
        buildWatchlistPayloadFromSearch(values, session.user.currencyPreference),
      );
      void recordEngagementEvent({
        eventType: "watchlist_create",
        properties: {
          filterCount: getActiveSearchFilterNames(values).length,
          hasQuery: values.query.trim().length > 0,
          surface: "search_page",
        },
        searchQuery: values.query.trim() || undefined,
      });
      setSaveFeedback(
        "Saved this search as a watchlist. The PostgreSQL worker can now create in-app matches.",
      );
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
      }
      setSaveErrorMessage(
        error instanceof Error ? error.message : "The watchlist could not be saved.",
      );
    } finally {
      setSavingAction(null);
    }
  }

  const saveActions = hasActiveSearch ? (
    <div>
      <div className="inline-actions">
        {session ? (
          <>
            <button
              className="secondary-button"
              disabled={savingAction !== null}
              onClick={handleSaveSearch}
              type="button"
            >
              {savingAction === "search" ? "Saving search..." : "Save search"}
            </button>
            <button
              className="secondary-button"
              disabled={savingAction !== null}
              onClick={handleSaveFilters}
              type="button"
            >
              {savingAction === "filters" ? "Saving filters..." : "Save filters"}
            </button>
            <button
              className="secondary-button"
              disabled={savingAction !== null}
              onClick={handleCreateWatchlistFromSearch}
              type="button"
            >
              {savingAction === "watchlist"
                ? "Saving watchlist..."
                : "Create watchlist from this search"}
            </button>
          </>
        ) : (
          <>
            <p className="page-description">Log in to save searches, filters, and watchlists.</p>
            <Link className="secondary-button link-button" to="/login">
              Log in to save
            </Link>
          </>
        )}
      </div>
      <p className="page-description">
        Watchlists save what you want to track. In-app matches require the production PostgreSQL
        worker.
      </p>
      {saveFeedback ? <p className="page-description">{saveFeedback}</p> : null}
      {saveErrorMessage ? <p className="form-error">{saveErrorMessage}</p> : null}
    </div>
  ) : null;

  return (
    <SearchPage>
      <section className="search-layout">
        <SearchControlPanel
          initialValues={values}
          marketplaceOptions={marketplaceOptions}
          onSubmit={handleSubmit}
          secondaryActions={saveActions}
        />
        <SearchResults
          likedListingIds={likedListingIds}
          onLoadMore={handleLoadMore}
          onRetry={handleRetry}
          onToggleLike={handleToggleLike}
          query={query}
          state={state}
          summary={describeSearch(values)}
          viewContextId={`search:${searchKey}`}
        />
      </section>
    </SearchPage>
  );
}

function formatRecentSearchDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function RecentSearchesRoutePage({
  onAuthFailure,
  session,
}: {
  onAuthFailure: () => void;
  session: AuthResponse | null;
}) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RecentSearchEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!session?.userId) {
      setEntries(loadRecentSearches());
      setErrorMessage(undefined);
      setStatus("success");
      return;
    }

    const controller = new AbortController();

    setStatus("loading");
    setErrorMessage(undefined);

    void fetchJson<RecentSearchesResponse>("/recent-searches", controller.signal)
      .then((response) => {
        setEntries(response.recentSearches);
        setStatus("success");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (isAuthRequiredError(error)) {
          onAuthFailure();
          setEntries(loadRecentSearches());
          setErrorMessage(undefined);
          setStatus("success");
          return;
        }

        setEntries([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Recent searches could not be loaded.",
        );
        setStatus("error");
      });

    return () => {
      controller.abort();
    };
  }, [onAuthFailure, session?.userId]);

  function handleClear() {
    if (!session?.userId) {
      clearRecentSearches();
      setEntries([]);
      setStatus("success");
      return;
    }

    void sendJson<{ cleared: boolean }>("/recent-searches", "DELETE", {})
      .then(() => {
        setEntries([]);
        setStatus("success");
      })
      .catch((error: unknown) => {
        if (isAuthRequiredError(error)) {
          onAuthFailure();
          setEntries(loadRecentSearches());
          setErrorMessage(undefined);
          setStatus("success");
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : "Recent searches could not be cleared.",
        );
        setStatus("error");
      });
  }

  function handleRunSearch(params: string) {
    startTransition(() => {
      navigate("/search?" + params);
    });
  }

  return (
    <RecentSearchesPage>
      <section className="recent-searches">
        {status === "loading" ? (
          <StateCard body="Loading your recent searches." title="Fetching history" />
        ) : null}

        {status === "error" ? (
          <StateCard
            body={errorMessage ?? "Recent searches could not be loaded."}
            title="Recent searches unavailable"
          />
        ) : null}

        {status === "success" && entries.length === 0 ? (
          <StateCard
            body="Run a few searches and they will show up here."
            title="No recent searches yet"
          />
        ) : null}

        {status === "success" && entries.length > 0 ? (
          <>
            <div className="section-heading section-heading--split">
              <div>
                <h2>{entries.length} recent searches</h2>
                <p>Jump back into a recent query without rebuilding your filters.</p>
              </div>
              <button className="secondary-button" onClick={handleClear} type="button">
                Clear history
              </button>
            </div>

            <div className="recent-search-grid">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className="recent-search-card"
                  onClick={() => handleRunSearch(entry.params)}
                  type="button"
                >
                  <h2>{entry.label}</h2>
                  <p>{entry.description}</p>
                  <span>{formatRecentSearchDate(entry.createdAt)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </RecentSearchesPage>
  );
}

function AnalyticsRoutePage({ session }: { session: AuthResponse | null }) {
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<AnalyticsRequestState>({
    brandSummaries: [],
    categorySummaries: [],
    locked: true,
    sampleData: false,
    signals: [],
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    const suffix = "";

    setState({
      brandSummaries: [],
      categorySummaries: [],
      locked: true,
      sampleData: false,
      signals: [],
      status: "loading",
    });

    void fetchJson<AnalyticsOverviewResponse>(`/analytics/overview${suffix}`, controller.signal)
      .then(async (overviewResponse) => {
        if (overviewResponse.locked) {
          setState({
            brandSummaries: [],
            categorySummaries: [],
            locked: true,
            message: overviewResponse.message,
            overview: overviewResponse.overview,
            premiumAccess: overviewResponse.premiumAccess,
            sampleData: false,
            signals: [],
            status: "success",
          });
          return;
        }

        const [insightsResponse, underpricedResponse] = await Promise.all([
          fetchJson<MarketInsightsResponse>(
            `/analytics/market-insights${suffix}`,
            controller.signal,
          ),
          fetchJson<UnderpricedSignalsResponse>(
            `/analytics/underpriced${suffix}`,
            controller.signal,
          ),
        ]);

        setState({
          brandSummaries: insightsResponse.brandSummaries ?? [],
          categorySummaries: insightsResponse.categorySummaries ?? [],
          locked: false,
          message: overviewResponse.message,
          overview: overviewResponse.overview,
          premiumAccess: overviewResponse.premiumAccess,
          sampleData:
            overviewResponse.sampleData === true ||
            insightsResponse.sampleData === true ||
            underpricedResponse.sampleData === true,
          signals: underpricedResponse.signals ?? [],
          status: "success",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          brandSummaries: [],
          categorySummaries: [],
          errorMessage:
            error instanceof Error ? error.message : "The analytics view could not be loaded.",
          locked: true,
          sampleData: false,
          signals: [],
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [reloadCount, session?.userId]);

  function handleRetry() {
    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  if (state.status === "loading") {
    return (
      <AnalyticsPage>
        <LoadingListings count={6} />
      </AnalyticsPage>
    );
  }

  if (state.status === "error") {
    return (
      <AnalyticsPage>
        <StateCard
          action={
            <button className="secondary-button" onClick={handleRetry} type="button">
              Try again
            </button>
          }
          body={
            state.errorMessage ??
            "The analytics view could not be loaded. Observed-data analytics are optional, so core browsing can still continue."
          }
          title="Analytics unavailable"
        />
      </AnalyticsPage>
    );
  }

  if (state.locked) {
    return (
      <AnalyticsPage>
        <section className="analytics-shell">
          <section className="market-header market-header--analytics">
            <div>
              <h2>Observed pricing context</h2>
              <p className="page-description">
                {state.message ??
                  "Observed market analytics require an active persisted entitlement."}
              </p>
            </div>
            <div className="chip-row">
              <span className="info-chip info-chip--accent">Premium</span>
              <span className="info-chip">Entitlement required</span>
            </div>
          </section>

          <div className="analytics-preview-grid">
            {[
              "Observed brand ranges",
              "Category pricing context",
              "Cautious under-market signals",
              "Seen-listings summaries",
            ].map((title) => (
              <article
                key={title}
                className="analytics-preview-card analytics-preview-card--locked"
              >
                <h2>{title}</h2>
              </article>
            ))}
          </div>

          <p className="analytics-note">
            Access is never inferred from a username. Development grants are explicitly non-billing
            and disabled in production.
          </p>
        </section>
      </AnalyticsPage>
    );
  }

  return (
    <AnalyticsPage>
      <section className="analytics-shell">
        <section className="market-header market-header--analytics">
          <div>
            <h2>{state.premiumAccess?.planName ?? "Observed pricing context"}</h2>
            <p className="page-description">
              Based on listings ClosetSearch has observed. Not financial advice. Not a prediction.
            </p>
          </div>
          <div className="chip-row">
            <span className="info-chip info-chip--accent">Premium analytics</span>
            {state.sampleData ? <span className="info-chip">Sample data</span> : null}
          </div>
        </section>

        {state.overview ? (
          <>
            <div className="analytics-overview-grid">
              <article className="analytics-stat-card">
                <p className="eyebrow">Observed listings</p>
                <h2>{state.overview.observedListingCount}</h2>
              </article>
              <article className="analytics-stat-card">
                <p className="eyebrow">Observed brands</p>
                <h2>{state.overview.observedBrandCount}</h2>
              </article>
              <article className="analytics-stat-card">
                <p className="eyebrow">Observed categories</p>
                <h2>{state.overview.observedCategoryCount}</h2>
              </article>
              <article className="analytics-stat-card">
                <p className="eyebrow">Under-market signals</p>
                <h2>{state.overview.underMarketSignalCount}</h2>
              </article>
              <article className="analytics-stat-card">
                <p className="eyebrow">Latest observation</p>
                <h2>
                  {state.overview.latestObservationAt
                    ? formatRecentSearchDate(state.overview.latestObservationAt)
                    : "No data yet"}
                </h2>
              </article>
            </div>
            <p className="analytics-note">{state.overview.dataQuality.note}</p>
          </>
        ) : null}

        <section className="analytics-section">
          <div className="section-heading">
            <h2>Brand pricing ranges</h2>
          </div>
          {state.brandSummaries.length > 0 ? (
            <div className="analytics-card-grid">
              {state.brandSummaries.map((summary) => (
                <article key={summary.brand} className="analytics-data-card">
                  <div className="analytics-data-card__header">
                    <div>
                      <p className="eyebrow">{summary.brand}</p>
                      <h2>{summary.range.count} observed listings</h2>
                    </div>
                    <span className="info-chip">
                      Median{" "}
                      {formatCurrencyAmount(summary.range.medianPrice, summary.range.currency)}
                    </span>
                  </div>
                  <p>
                    Observed range:{" "}
                    {formatObservedRange(
                      summary.range.minPrice,
                      summary.range.maxPrice,
                      summary.range.currency,
                    )}
                  </p>
                  <div className="chip-row">
                    <span className="info-chip">
                      Average{" "}
                      {formatCurrencyAmount(summary.range.averagePrice, summary.range.currency)}
                    </span>
                    <span className="info-chip">{summary.range.currency}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateCard
              body="ClosetSearch needs more observed listings before brand ranges are useful."
              title="No brand pricing data yet"
            />
          )}
        </section>

        <section className="analytics-section">
          <div className="section-heading">
            <h2>Category pricing ranges</h2>
          </div>
          {state.categorySummaries.length > 0 ? (
            <div className="analytics-card-grid">
              {state.categorySummaries.map((summary) => (
                <article key={summary.category} className="analytics-data-card">
                  <div className="analytics-data-card__header">
                    <div>
                      <p className="eyebrow">{summary.category}</p>
                      <h2>{summary.range.count} observed listings</h2>
                    </div>
                    <span className="info-chip">
                      Median{" "}
                      {formatCurrencyAmount(summary.range.medianPrice, summary.range.currency)}
                    </span>
                  </div>
                  <p>
                    Observed range:{" "}
                    {formatObservedRange(
                      summary.range.minPrice,
                      summary.range.maxPrice,
                      summary.range.currency,
                    )}
                  </p>
                  <div className="chip-row">
                    <span className="info-chip">
                      Average{" "}
                      {formatCurrencyAmount(summary.range.averagePrice, summary.range.currency)}
                    </span>
                    <span className="info-chip">{summary.range.currency}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateCard
              body="ClosetSearch needs more observed listings before category ranges are useful."
              title="No category pricing data yet"
            />
          )}
        </section>

        <section className="analytics-section">
          <div className="section-heading">
            <h2>Under-market signals</h2>
          </div>
          {state.signals.length > 0 ? (
            <div className="analytics-card-grid">
              {state.signals.map((signal) => (
                <article key={signal.id} className="analytics-data-card">
                  {signal.imageUrl ? (
                    <img
                      alt={signal.listingTitle}
                      className="analytics-signal-image"
                      src={signal.imageUrl}
                    />
                  ) : null}
                  <div className="analytics-data-card__header">
                    <div>
                      <p className="eyebrow">
                        {[signal.brand, signal.category].filter(Boolean).join(" • ") ||
                          signal.source}
                      </p>
                      <h2>{signal.listingTitle}</h2>
                    </div>
                    <span className="info-chip info-chip--accent">{signal.label}</span>
                  </div>
                  <p>{signal.summary}</p>
                  <div className="analytics-pricing-row">
                    <div>
                      <span>Current</span>
                      <strong>
                        {formatCurrencyAmount(signal.currentPrice, signal.currentCurrency)}
                      </strong>
                    </div>
                    <div>
                      <span>Observed median</span>
                      <strong>
                        {formatCurrencyAmount(signal.observedMedianPrice, signal.observedCurrency)}
                      </strong>
                    </div>
                    <div>
                      <span>Observed range</span>
                      <strong>
                        {formatObservedRange(
                          signal.observedMinPrice,
                          signal.observedMaxPrice,
                          signal.observedCurrency,
                        )}
                      </strong>
                    </div>
                  </div>
                  <div className="chip-row">
                    <span className="info-chip">{signal.comparableCount} comparable listings</span>
                    <span className="info-chip">{signal.comparisonScope}</span>
                    <span className="info-chip">
                      Seen {formatRecentSearchDate(signal.observedAt)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateCard
              body="No cautious pricing signals are available yet. ClosetSearch only shows these when it has enough similar observed listings."
              title="No under-market signals yet"
            />
          )}
        </section>

        {state.overview ? (
          <section className="analytics-section">
            <div className="section-heading">
              <h2>Disclaimers</h2>
            </div>
            <div className="analytics-card-grid">
              {state.overview.disclaimers.map((disclaimer) => (
                <article key={disclaimer.label} className="analytics-data-card">
                  <div className="analytics-data-card__header">
                    <div>
                      <p className="eyebrow">{disclaimer.label}</p>
                      <h2>{disclaimer.text}</h2>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </AnalyticsPage>
  );
}

function BetaInfoRoutePage() {
  return (
    <BetaInfoPage>
      <section className="recent-searches">
        <div className="section-heading section-heading--split">
          <div>
            <h2>Beta privacy and data use</h2>
            <p>
              ClosetSearch stores account data such as usernames, onboarding preferences, likes,
              saved searches, saved filters, watchlists, notification preferences, and basic
              settings. Observed listing snapshots are also stored to support cautious analytics.
            </p>
          </div>
        </div>

        <div className="recent-search-grid">
          <article className="recent-search-card">
            <h2>Account and saved data</h2>
            <p>
              Your saved likes, searches, filters, watchlists, and settings persist in the beta
              database so your signed-in experience survives refreshes and restarts.
            </p>
          </article>
          <article className="recent-search-card">
            <h2>Observed analytics only</h2>
            <p>
              Pricing context is based on listings ClosetSearch has observed. It is not financial
              advice, not a prediction, and not a guarantee that a listing is underpriced.
            </p>
          </article>
          <article className="recent-search-card">
            <h2>Alert delivery has explicit dependencies</h2>
            <p>
              The production PostgreSQL worker can create in-app alerts. Email requires a configured
              provider and verified address; push and SMS are unavailable.
            </p>
          </article>
        </div>

        <div className="section-heading section-heading--split">
          <div>
            <h2>Beta feedback</h2>
            <p>
              Testers should try feed, search, auth, saved features, personalization, analytics, and
              watchlists, then share bugs, confusing moments, and missing beta-blocking flows.
            </p>
          </div>
        </div>

        <div className="inline-actions">
          <a
            className="secondary-button link-button"
            href={betaFeedbackUrl}
            rel="noreferrer"
            target="_blank"
          >
            Beta feedback
          </a>
          <Link className="secondary-button link-button" to="/profile">
            Back to profile
          </Link>
        </div>

        <p className="page-description">
          Provider data can be incomplete or delayed, trust signals stay assistive only, and this
          repo is prepared for a constrained beta rather than a full public production launch.
        </p>
      </section>
    </BetaInfoPage>
  );
}

function ProfileRoutePage({
  onAccountDeleted,
  onAuthFailure,
  session,
}: {
  onAccountDeleted: () => void;
  onAuthFailure: () => void;
  session: AuthResponse | null;
}) {
  const marketplaceOptions = useMarketplaceOptions();
  const navigate = useNavigate();
  const { likes, likedListingIds, likedListings, toggleLike } = useLikes(session, onAuthFailure);
  const [reloadCount, setReloadCount] = useState(0);
  const [collectionsState, setCollectionsState] = useState<ProfileCollectionsState>({
    notificationPreferences: undefined,
    savedFilters: [],
    savedSearches: [],
    status: session ? "loading" : "success",
    watchlists: [],
  });
  const [settingsForm, setSettingsForm] = useState({
    defaultSortMode: "",
    displayName: "",
    preferredCurrency: "USD",
    preferredSources: [] as string[],
  });
  const [collectionsFeedback, setCollectionsFeedback] = useState<string | undefined>();
  const [watchlistForm, setWatchlistForm] = useState<WatchlistFormState>(() =>
    createEmptyWatchlistForm(),
  );
  const [editingWatchlistId, setEditingWatchlistId] = useState<string | undefined>();
  const [notificationPreferencesForm, setNotificationPreferencesForm] = useState({
    emailEnabled: false,
    frequency: "daily" as NotificationPreferences["frequency"],
    inAppEnabled: true,
    pushEnabled: false,
    quietHoursEnd: "",
    quietHoursStart: "",
    smsEnabled: false,
  });
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | undefined>();
  const [settingsFeedback, setSettingsFeedback] = useState<string | undefined>();
  const [watchlistErrorMessage, setWatchlistErrorMessage] = useState<string | undefined>();
  const [watchlistFeedback, setWatchlistFeedback] = useState<string | undefined>();
  const [notificationPreferencesErrorMessage, setNotificationPreferencesErrorMessage] = useState<
    string | undefined
  >();
  const [notificationPreferencesFeedback, setNotificationPreferencesFeedback] = useState<
    string | undefined
  >();
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingWatchlist, setIsSavingWatchlist] = useState(false);
  const [isSavingNotificationPreferences, setIsSavingNotificationPreferences] = useState(false);

  useEffect(() => {
    if (!session) {
      setCollectionsState({
        notificationPreferences: undefined,
        savedFilters: [],
        savedSearches: [],
        status: "success",
        watchlists: [],
      });
      setCollectionsFeedback(undefined);
      setEditingWatchlistId(undefined);
      return;
    }

    const controller = new AbortController();

    setCollectionsState((currentState) => ({
      ...currentState,
      errorMessage: undefined,
      status: "loading",
    }));
    setCollectionsFeedback(undefined);

    void Promise.all([
      fetchJson<SavedSearchesResponse>("/me/saved-searches", controller.signal),
      fetchJson<SavedFiltersResponse>("/me/saved-filters", controller.signal),
      fetchJson<WatchlistsResponse>("/me/watchlists", controller.signal),
      fetchJson<SettingsResponse>("/me/settings", controller.signal),
      fetchJson<NotificationPreferencesResponse>("/me/notification-preferences", controller.signal),
    ])
      .then(
        ([
          savedSearchResponse,
          savedFilterResponse,
          watchlistResponse,
          settingsResponse,
          notificationPreferencesResponse,
        ]) => {
          setCollectionsState({
            notificationPreferences: notificationPreferencesResponse.notificationPreferences,
            savedFilters: savedFilterResponse.savedFilters,
            savedSearches: savedSearchResponse.savedSearches,
            settings: settingsResponse.settings,
            status: "success",
            watchlists: watchlistResponse.watchlists,
          });
          setSettingsForm({
            defaultSortMode: settingsResponse.settings.defaultSortMode ?? "",
            displayName: settingsResponse.settings.displayName ?? "",
            preferredCurrency: settingsResponse.settings.preferredCurrency,
            preferredSources: settingsResponse.settings.preferredSources,
          });
          setNotificationPreferencesForm({
            emailEnabled: notificationPreferencesResponse.notificationPreferences.emailEnabled,
            frequency: notificationPreferencesResponse.notificationPreferences.frequency,
            inAppEnabled: notificationPreferencesResponse.notificationPreferences.inAppEnabled,
            pushEnabled: notificationPreferencesResponse.notificationPreferences.pushEnabled,
            quietHoursEnd:
              notificationPreferencesResponse.notificationPreferences.quietHoursEnd ?? "",
            quietHoursStart:
              notificationPreferencesResponse.notificationPreferences.quietHoursStart ?? "",
            smsEnabled: notificationPreferencesResponse.notificationPreferences.smsEnabled,
          });
          setWatchlistForm((currentState) => {
            const hasUserDraft =
              currentState.label.trim().length > 0 ||
              currentState.queryText.trim().length > 0 ||
              currentState.brand.trim().length > 0 ||
              currentState.category.trim().length > 0 ||
              currentState.source.trim().length > 0 ||
              currentState.minPriceAmount.trim().length > 0 ||
              currentState.maxPriceAmount.trim().length > 0 ||
              currentState.size.trim().length > 0 ||
              currentState.condition.trim().length > 0;

            return hasUserDraft
              ? currentState
              : createEmptyWatchlistForm(settingsResponse.settings.preferredCurrency);
          });
        },
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (isAuthRequiredError(error)) {
          onAuthFailure();
          return;
        }

        setCollectionsState({
          errorMessage:
            error instanceof Error ? error.message : "Your saved account data could not be loaded.",
          notificationPreferences: undefined,
          savedFilters: [],
          savedSearches: [],
          status: "error",
          watchlists: [],
        });
      });

    return () => {
      controller.abort();
    };
  }, [onAuthFailure, reloadCount, session]);

  if (!session) {
    return (
      <ProfilePage>
        <StateCard
          action={
            <div className="inline-actions">
              <Link className="secondary-button link-button" to="/login">
                Log in
              </Link>
              <Link className="search-form__button link-button" to="/signup">
                Create account
              </Link>
            </div>
          }
          body="Log in or create an account to save likes, searches, filters, watchlists, and settings."
          title="Profile needs an account"
        />
      </ProfilePage>
    );
  }

  const preferences = summarizeOnboardingPreferences(session);
  const preferredCurrency =
    collectionsState.settings?.preferredCurrency ?? session.user.currencyPreference;
  const displayName = collectionsState.settings?.displayName?.trim() || session.user.username;

  function handleReload() {
    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  function handleRunSavedSearch(params: string) {
    recordSearchInteraction(
      parseSearchFormValues(new URLSearchParams(params)),
      "profile_saved_search",
    );

    startTransition(() => {
      navigate(params ? "/search?" + params : "/search");
    });
  }

  function handleApplySavedFilter(savedFilter: SavedFilter) {
    const nextValues = createSavedFilterValues(savedFilter);
    recordSearchInteraction(nextValues, "profile_saved_filter");

    startTransition(() => {
      navigate(buildSearchPath(nextValues));
    });
  }

  function resetWatchlistComposer() {
    setEditingWatchlistId(undefined);
    setWatchlistForm(createEmptyWatchlistForm(preferredCurrency));
  }

  async function handleToggleLikeFromProfile(listing: Listing, nextLiked: boolean) {
    await toggleLike(listing, nextLiked, "liked_items");
  }

  async function handleDeleteSavedSearch(savedSearch: SavedSearch) {
    try {
      await sendJson<{ removed: boolean }>("/me/saved-searches", "DELETE", {
        id: savedSearch.id,
      });
      setCollectionsState((currentState) => ({
        ...currentState,
        savedSearches: currentState.savedSearches.filter((entry) => entry.id !== savedSearch.id),
      }));
      setCollectionsFeedback(`Deleted saved search "${savedSearch.label}".`);
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setCollectionsState((currentState) => ({
        ...currentState,
        errorMessage:
          error instanceof Error ? error.message : "The saved search could not be deleted.",
      }));
    }
  }

  async function handleDeleteSavedFilter(savedFilter: SavedFilter) {
    try {
      await sendJson<{ removed: boolean }>("/me/saved-filters", "DELETE", {
        id: savedFilter.id,
      });
      setCollectionsState((currentState) => ({
        ...currentState,
        savedFilters: currentState.savedFilters.filter((entry) => entry.id !== savedFilter.id),
      }));
      setCollectionsFeedback(`Deleted saved filter "${savedFilter.label}".`);
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setCollectionsState((currentState) => ({
        ...currentState,
        errorMessage:
          error instanceof Error ? error.message : "The saved filter could not be deleted.",
      }));
    }
  }

  function handleEditWatchlist(watchlist: Watchlist) {
    setEditingWatchlistId(watchlist.id);
    setWatchlistErrorMessage(undefined);
    setWatchlistFeedback(undefined);
    setWatchlistForm(createWatchlistFormFromWatchlist(watchlist, preferredCurrency));
  }

  async function handleToggleWatchlistEnabled(watchlist: Watchlist) {
    try {
      const response = await sendJson<WatchlistsResponse>(
        "/me/watchlists/" + watchlist.id,
        "PATCH",
        {
          enabled: !watchlist.enabled,
        },
      );
      setCollectionsState((currentState) => ({
        ...currentState,
        watchlists: response.watchlists,
      }));
      setWatchlistFeedback((watchlist.enabled ? "Paused " : "Resumed ") + watchlist.label + ".");
      if (editingWatchlistId === watchlist.id) {
        setWatchlistForm((currentState) => ({
          ...currentState,
          enabled: !watchlist.enabled,
        }));
      }
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setWatchlistErrorMessage(
        error instanceof Error ? error.message : "The watchlist could not be updated.",
      );
    }
  }

  async function handleDeleteWatchlist(watchlist: Watchlist) {
    try {
      await sendJson<{ removed: boolean }>("/me/watchlists/" + watchlist.id, "DELETE", {});
      setCollectionsState((currentState) => ({
        ...currentState,
        watchlists: currentState.watchlists.filter((entry) => entry.id !== watchlist.id),
      }));
      setCollectionsFeedback(`Deleted watchlist "${watchlist.label}".`);
      if (editingWatchlistId === watchlist.id) {
        resetWatchlistComposer();
      }
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setCollectionsState((currentState) => ({
        ...currentState,
        errorMessage:
          error instanceof Error ? error.message : "The watchlist could not be deleted.",
      }));
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setSettingsErrorMessage(undefined);
    setSettingsFeedback(undefined);

    try {
      const response = await sendJson<SettingsResponse>("/me/settings", "PATCH", {
        defaultSortMode: settingsForm.defaultSortMode || null,
        displayName: settingsForm.displayName.trim() || null,
        preferredCurrency: settingsForm.preferredCurrency,
        preferredSources: settingsForm.preferredSources,
      });

      setCollectionsState((currentState) => ({
        ...currentState,
        settings: response.settings,
      }));
      setSettingsForm({
        defaultSortMode: response.settings.defaultSortMode ?? "",
        displayName: response.settings.displayName ?? "",
        preferredCurrency: response.settings.preferredCurrency,
        preferredSources: response.settings.preferredSources,
      });
      setSettingsFeedback("Updated your settings.");
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setSettingsErrorMessage(
        error instanceof Error ? error.message : "Your settings could not be saved.",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleSaveWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isCreatingWatchlist = !editingWatchlistId;
    setIsSavingWatchlist(true);
    setWatchlistErrorMessage(undefined);
    setWatchlistFeedback(undefined);

    try {
      const response = editingWatchlistId
        ? await sendJson<WatchlistsResponse>(
            "/me/watchlists/" + editingWatchlistId,
            "PATCH",
            buildWatchlistPayload({
              ...watchlistForm,
              priceCurrency: watchlistForm.priceCurrency || preferredCurrency,
            }),
          )
        : await sendJson<WatchlistsResponse>(
            "/me/watchlists",
            "POST",
            buildWatchlistPayload({
              ...watchlistForm,
              priceCurrency: watchlistForm.priceCurrency || preferredCurrency,
            }),
          );

      setCollectionsState((currentState) => ({
        ...currentState,
        watchlists: response.watchlists,
      }));
      setWatchlistFeedback(
        editingWatchlistId
          ? "Updated your watchlist. The production worker will use the new criteria."
          : "Saved your watchlist. The production worker can now create in-app matches.",
      );

      if (isCreatingWatchlist) {
        const constraintCount = [
          watchlistForm.brand,
          watchlistForm.category,
          watchlistForm.condition,
          watchlistForm.listingType,
          watchlistForm.maxPriceAmount,
          watchlistForm.minPriceAmount,
          watchlistForm.queryText,
          watchlistForm.size,
          watchlistForm.source,
        ].filter((value) => value.trim().length > 0).length;

        void recordEngagementEvent({
          eventType: "watchlist_create",
          properties: {
            constraintCount,
            hasQuery: watchlistForm.queryText.trim().length > 0,
            surface: "profile",
          },
          searchQuery: watchlistForm.queryText.trim() || undefined,
        });
      }

      resetWatchlistComposer();
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setWatchlistErrorMessage(
        error instanceof Error ? error.message : "The watchlist could not be saved.",
      );
    } finally {
      setIsSavingWatchlist(false);
    }
  }

  async function handleSaveNotificationPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingNotificationPreferences(true);
    setNotificationPreferencesErrorMessage(undefined);
    setNotificationPreferencesFeedback(undefined);

    try {
      const response = await sendJson<NotificationPreferencesResponse>(
        "/me/notification-preferences",
        "PATCH",
        {
          emailEnabled: notificationPreferencesForm.emailEnabled,
          frequency: notificationPreferencesForm.frequency,
          inAppEnabled: notificationPreferencesForm.inAppEnabled,
          pushEnabled: notificationPreferencesForm.pushEnabled,
          quietHoursEnd: notificationPreferencesForm.quietHoursEnd || null,
          quietHoursStart: notificationPreferencesForm.quietHoursStart || null,
          smsEnabled: notificationPreferencesForm.smsEnabled,
        },
      );

      setCollectionsState((currentState) => ({
        ...currentState,
        notificationPreferences: response.notificationPreferences,
      }));
      setNotificationPreferencesForm({
        emailEnabled: response.notificationPreferences.emailEnabled,
        frequency: response.notificationPreferences.frequency,
        inAppEnabled: response.notificationPreferences.inAppEnabled,
        pushEnabled: response.notificationPreferences.pushEnabled,
        quietHoursEnd: response.notificationPreferences.quietHoursEnd ?? "",
        quietHoursStart: response.notificationPreferences.quietHoursStart ?? "",
        smsEnabled: response.notificationPreferences.smsEnabled,
      });
      setNotificationPreferencesFeedback(
        "Saved notification preferences. In-app processing requires the PostgreSQL worker; email requires a configured provider and verified address. Push and SMS remain unavailable.",
      );
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setNotificationPreferencesErrorMessage(
        error instanceof Error ? error.message : "Notification preferences could not be saved.",
      );
    } finally {
      setIsSavingNotificationPreferences(false);
    }
  }

  return (
    <ProfilePage>
      <section className="profile-grid">
        <article className="profile-panel">
          <p className="eyebrow">Account</p>
          <h2>{displayName}</h2>
          <p>@{session.user.username}</p>
          <p>Joined {formatRecentSearchDate(session.user.createdAt)}.</p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Saved overview</p>
          <h2>
            {likes.length +
              collectionsState.savedSearches.length +
              collectionsState.savedFilters.length +
              collectionsState.watchlists.length}
          </h2>
          <p>
            {likes.length} likes • {collectionsState.savedSearches.length} saved searches
            <br />
            {collectionsState.savedFilters.length} saved filters •{" "}
            {collectionsState.watchlists.length} watchlists
          </p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Preferences</p>
          <h2>{preferences.priceRange}</h2>
          <p>
            Brands: {preferences.favoriteBrands}
            <br />
            Categories: {preferences.categories}
          </p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Settings</p>
          <h2>{preferredCurrency}</h2>
          <p>
            Default sort: {collectionsState.settings?.defaultSortMode ?? "relevance"}
            <br />
            Preferred sources:{" "}
            {collectionsState.settings?.preferredSources.join(", ") || "Any marketplace"}
          </p>
        </article>
      </section>

      <AccountSecurityPanel
        onAccountDeleted={onAccountDeleted}
        onAuthFailure={onAuthFailure}
        username={session.user.username}
      />

      {collectionsState.status === "loading" ? (
        <StateCard body="Loading your saved account data." title="Fetching profile" />
      ) : null}

      {collectionsState.status === "error" ? (
        <StateCard
          action={
            <button className="secondary-button" onClick={handleReload} type="button">
              Try again
            </button>
          }
          body={collectionsState.errorMessage ?? "Your saved account data could not be loaded."}
          title="Profile unavailable"
        />
      ) : null}

      {collectionsState.status === "success" ? (
        <section className="recent-searches">
          {collectionsFeedback ? <p className="page-description">{collectionsFeedback}</p> : null}
          <div className="section-heading section-heading--split">
            <div>
              <h2>Liked items</h2>
              <p>Your saved marketplace likes persist here across refreshes and restarts.</p>
            </div>
          </div>

          {likedListings.length > 0 ? (
            <ListingGrid
              engagement={{
                surface: "liked_items",
                viewContextId: "profile_liked_items",
              }}
              likedListingIds={likedListingIds}
              listings={likedListings.map((entry) => entry.listing)}
              onToggleLike={handleToggleLikeFromProfile}
            />
          ) : (
            <StateCard
              body="Like a few listings from home or search to keep them here."
              title="No liked items yet"
            />
          )}

          <div className="section-heading section-heading--split">
            <div>
              <h2>Saved searches</h2>
              <p>Jump back into your saved search params without rebuilding them.</p>
            </div>
          </div>

          {collectionsState.savedSearches.length > 0 ? (
            <div className="recent-search-grid">
              {collectionsState.savedSearches.map((savedSearch) => (
                <article key={savedSearch.id} className="recent-search-card">
                  <h2>{savedSearch.label}</h2>
                  <p>{savedSearch.description}</p>
                  <span>{formatRecentSearchDate(savedSearch.createdAt)}</span>
                  <div className="inline-actions">
                    <button
                      className="secondary-button"
                      onClick={() => handleRunSavedSearch(savedSearch.params)}
                      type="button"
                    >
                      Open search
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleDeleteSavedSearch(savedSearch)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateCard
              body="Save a search from the search page to reuse it here later."
              title="No saved searches yet"
            />
          )}

          <div className="section-heading section-heading--split">
            <div>
              <h2>Saved filters</h2>
              <p>Reuse your source, sort, type, and price presets from one place.</p>
            </div>
          </div>

          {collectionsState.savedFilters.length > 0 ? (
            <div className="recent-search-grid">
              {collectionsState.savedFilters.map((savedFilter) => (
                <article key={savedFilter.id} className="recent-search-card">
                  <h2>{savedFilter.label}</h2>
                  <p>{formatFilterSummary(savedFilter, preferredCurrency)}</p>
                  <span>{formatRecentSearchDate(savedFilter.updatedAt)}</span>
                  <div className="inline-actions">
                    <button
                      className="secondary-button"
                      onClick={() => handleApplySavedFilter(savedFilter)}
                      type="button"
                    >
                      Apply filters
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleDeleteSavedFilter(savedFilter)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateCard
              body="Save filters from the search page to keep your favorite presets here."
              title="No saved filters yet"
            />
          )}

          <div className="section-heading section-heading--split">
            <div>
              <h2>Watchlists</h2>
              <p>
                The production PostgreSQL worker matches new and changed listings against enabled
                watchlists and adds results to your in-app inbox.
              </p>
              <p>Email requires configuration and verification. Push and SMS are unavailable.</p>
            </div>
            <Link className="secondary-button link-button" to="/alerts">
              Open alert inbox
            </Link>
          </div>

          <form className="account-form" onSubmit={handleSaveWatchlist}>
            <label className="field-group" htmlFor="watchlist-label">
              <span>Label</span>
              <input
                id="watchlist-label"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    label: event.target.value,
                  }))
                }
                placeholder="Optional label"
                value={watchlistForm.label}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-query">
              <span>Query text</span>
              <input
                id="watchlist-query"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    queryText: event.target.value,
                  }))
                }
                placeholder="kapital"
                value={watchlistForm.queryText}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-brand">
              <span>Brand</span>
              <input
                id="watchlist-brand"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    brand: event.target.value,
                  }))
                }
                placeholder="Kapital"
                value={watchlistForm.brand}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-category">
              <span>Category</span>
              <input
                id="watchlist-category"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    category: event.target.value,
                  }))
                }
                placeholder="jacket"
                value={watchlistForm.category}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-source">
              <span>Marketplace</span>
              <select
                id="watchlist-source"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    source: event.target.value,
                  }))
                }
                value={watchlistForm.source}
              >
                {marketplaceOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group" htmlFor="watchlist-listing-type">
              <span>Listing type</span>
              <select
                id="watchlist-listing-type"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    listingType: event.target.value as WatchlistFormState["listingType"],
                  }))
                }
                value={watchlistForm.listingType}
              >
                {listingTypeOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group" htmlFor="watchlist-min-price">
              <span>Min price</span>
              <input
                id="watchlist-min-price"
                min="0"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    minPriceAmount: event.target.value,
                  }))
                }
                placeholder="100"
                type="number"
                value={watchlistForm.minPriceAmount}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-max-price">
              <span>Max price</span>
              <input
                id="watchlist-max-price"
                min="0"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    maxPriceAmount: event.target.value,
                  }))
                }
                placeholder="250"
                type="number"
                value={watchlistForm.maxPriceAmount}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-currency">
              <span>Currency</span>
              <input
                id="watchlist-currency"
                maxLength={3}
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    priceCurrency: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="USD"
                value={watchlistForm.priceCurrency}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-size">
              <span>Size</span>
              <input
                id="watchlist-size"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    size: event.target.value,
                  }))
                }
                placeholder="M"
                value={watchlistForm.size}
              />
            </label>

            <label className="field-group" htmlFor="watchlist-condition">
              <span>Condition</span>
              <select
                id="watchlist-condition"
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    condition: event.target.value,
                  }))
                }
                value={watchlistForm.condition}
              >
                <option value="">Any condition</option>
                <option value="new_with_tags">New with tags</option>
                <option value="new_without_tags">New without tags</option>
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
              </select>
            </label>

            <label className="info-chip">
              <input
                checked={watchlistForm.enabled}
                onChange={(event) =>
                  setWatchlistForm((currentState) => ({
                    ...currentState,
                    enabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Watchlist enabled
            </label>

            {watchlistFeedback ? <p className="page-description">{watchlistFeedback}</p> : null}
            {watchlistErrorMessage ? <p className="form-error">{watchlistErrorMessage}</p> : null}

            <div className="search-panel__actions">
              <button className="search-form__button" disabled={isSavingWatchlist} type="submit">
                {isSavingWatchlist
                  ? "Saving watchlist..."
                  : editingWatchlistId
                    ? "Update watchlist"
                    : "Save watchlist"}
              </button>
              {editingWatchlistId ? (
                <button className="secondary-button" onClick={resetWatchlistComposer} type="button">
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          {collectionsState.watchlists.length > 0 ? (
            <div className="recent-search-grid">
              {collectionsState.watchlists.map((watchlist) => (
                <article key={watchlist.id} className="recent-search-card">
                  <h2>{watchlist.label}</h2>
                  <p>{formatWatchlistSummary(watchlist, preferredCurrency)}</p>
                  <span>{formatRecentSearchDate(watchlist.updatedAt)}</span>
                  <div className="inline-actions">
                    <button
                      className="secondary-button"
                      onClick={() => handleEditWatchlist(watchlist)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleToggleWatchlistEnabled(watchlist)}
                      type="button"
                    >
                      {watchlist.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleDeleteWatchlist(watchlist)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateCard
              body="Add a watched search, brand, or price range. The production worker will create in-app alerts for matching listings."
              title="No watchlists yet"
            />
          )}

          <div className="section-heading section-heading--split">
            <div>
              <h2>Notification preferences</h2>
              <p>
                In-app delivery runs with the production PostgreSQL worker. Email requires a
                configured provider and verified address. Push and SMS are unavailable.
              </p>
            </div>
          </div>

          <form className="account-form" onSubmit={handleSaveNotificationPreferences}>
            <label className="info-chip">
              <input
                checked={notificationPreferencesForm.inAppEnabled}
                onChange={(event) =>
                  setNotificationPreferencesForm((currentState) => ({
                    ...currentState,
                    inAppEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              In-app enabled
            </label>

            <label className="info-chip">
              <input checked={notificationPreferencesForm.emailEnabled} disabled type="checkbox" />
              Email (requires configured delivery)
            </label>

            <label className="info-chip">
              <input checked={notificationPreferencesForm.pushEnabled} disabled type="checkbox" />
              Push (unavailable)
            </label>

            <label className="info-chip">
              <input checked={notificationPreferencesForm.smsEnabled} disabled type="checkbox" />
              SMS (unavailable)
            </label>

            <label className="field-group" htmlFor="notification-frequency">
              <span>Frequency</span>
              <select
                id="notification-frequency"
                onChange={(event) =>
                  setNotificationPreferencesForm((currentState) => ({
                    ...currentState,
                    frequency: event.target.value as NotificationPreferences["frequency"],
                  }))
                }
                value={notificationPreferencesForm.frequency}
              >
                <option value="instant">Instant</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>

            <label className="field-group" htmlFor="notification-quiet-start">
              <span>Quiet hours start</span>
              <input
                id="notification-quiet-start"
                onChange={(event) =>
                  setNotificationPreferencesForm((currentState) => ({
                    ...currentState,
                    quietHoursStart: event.target.value,
                  }))
                }
                type="time"
                value={notificationPreferencesForm.quietHoursStart}
              />
            </label>

            <label className="field-group" htmlFor="notification-quiet-end">
              <span>Quiet hours end</span>
              <input
                id="notification-quiet-end"
                onChange={(event) =>
                  setNotificationPreferencesForm((currentState) => ({
                    ...currentState,
                    quietHoursEnd: event.target.value,
                  }))
                }
                type="time"
                value={notificationPreferencesForm.quietHoursEnd}
              />
            </label>

            {notificationPreferencesFeedback ? (
              <p className="page-description">{notificationPreferencesFeedback}</p>
            ) : null}
            {notificationPreferencesErrorMessage ? (
              <p className="form-error">{notificationPreferencesErrorMessage}</p>
            ) : null}

            <div className="search-panel__actions">
              <button
                className="search-form__button"
                disabled={isSavingNotificationPreferences}
                type="submit"
              >
                {isSavingNotificationPreferences
                  ? "Saving preferences..."
                  : "Save notification preferences"}
              </button>
            </div>
          </form>

          <div className="section-heading section-heading--split">
            <div>
              <h2>Settings</h2>
              <p>
                Currency is a display preference scaffold for now; listing prices stay
                marketplace-native until conversion ships.
              </p>
            </div>
          </div>

          <form className="account-form" onSubmit={handleSaveSettings}>
            <label className="field-group" htmlFor="settings-display-name">
              <span>Display name</span>
              <input
                id="settings-display-name"
                onChange={(event) =>
                  setSettingsForm((currentState) => ({
                    ...currentState,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Archive Kid"
                value={settingsForm.displayName}
              />
            </label>

            <label className="field-group" htmlFor="settings-currency">
              <span>Preferred currency</span>
              <select
                id="settings-currency"
                onChange={(event) =>
                  setSettingsForm((currentState) => ({
                    ...currentState,
                    preferredCurrency: event.target.value,
                  }))
                }
                value={settingsForm.preferredCurrency}
              >
                {[
                  { label: "USD", value: "USD" },
                  { label: "EUR", value: "EUR" },
                  { label: "GBP", value: "GBP" },
                  { label: "JPY", value: "JPY" },
                ].map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group" htmlFor="settings-sort-mode">
              <span>Default sort mode</span>
              <select
                id="settings-sort-mode"
                onChange={(event) =>
                  setSettingsForm((currentState) => ({
                    ...currentState,
                    defaultSortMode: event.target.value,
                  }))
                }
                value={settingsForm.defaultSortMode}
              >
                <option value="">Use search defaults</option>
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="field-group">
              <span>Preferred sources</span>
              <div className="chip-row">
                {marketplaceOptions
                  .filter((option) => option.value)
                  .map((option) => {
                    const checked = settingsForm.preferredSources.includes(option.value);

                    return (
                      <label key={option.value} className="info-chip">
                        <input
                          checked={checked}
                          onChange={(event) => {
                            setSettingsForm((currentState) => ({
                              ...currentState,
                              preferredSources: event.target.checked
                                ? [...currentState.preferredSources, option.value]
                                : currentState.preferredSources.filter(
                                    (entry) => entry !== option.value,
                                  ),
                            }));
                          }}
                          type="checkbox"
                        />
                        {option.label}
                      </label>
                    );
                  })}
              </div>
            </fieldset>

            {settingsFeedback ? <p className="page-description">{settingsFeedback}</p> : null}
            {settingsErrorMessage ? <p className="form-error">{settingsErrorMessage}</p> : null}

            <div className="search-panel__actions">
              <button className="search-form__button" disabled={isSavingSettings} type="submit">
                {isSavingSettings ? "Saving settings..." : "Save settings"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </ProfilePage>
  );
}

function BrandsRoutePage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [state, setState] = useState<BrandListRequestState>({
    brands: [],
    status: "loading",
    total: 0,
  });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    const trimmedQuery = deferredQuery.trim();

    if (trimmedQuery.length > 0) {
      params.set("q", trimmedQuery);
    }

    setState((currentState) => ({
      ...currentState,
      errorMessage: undefined,
      status: "loading",
    }));

    void fetchJson<BrandListResponse>(
      `/brands${params.toString() ? `?${params.toString()}` : ""}`,
      controller.signal,
    )
      .then((response) => {
        setState({
          brands: response.brands,
          status: "success",
          total: response.total,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          brands: [],
          errorMessage: error instanceof Error ? error.message : "Brand browsing is unavailable.",
          status: "error",
          total: 0,
        });
      });

    return () => {
      controller.abort();
    };
  }, [deferredQuery]);

  return (
    <BrandsPage>
      <section className="brand-directory">
        <div className="section-heading">
          <div>
            <h2>Browse labels</h2>
            <p>Search by name, alias, or style tag.</p>
          </div>
        </div>

        <label className="field-group" htmlFor="brand-directory-search">
          <span>Search</span>
          <input
            id="brand-directory-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search brands, aliases, or style tags"
            value={query}
          />
        </label>

        {state.status === "loading" ? <LoadingListings count={6} /> : null}

        {state.status === "error" ? (
          <StateCard
            body={state.errorMessage ?? "The brand directory could not be loaded."}
            title="Brands unavailable"
          />
        ) : null}

        {state.status === "success" ? (
          state.brands.length > 0 ? (
            <div className="brand-grid">
              {state.brands.map((brand) => (
                <Link
                  key={brand.id}
                  className="brand-card"
                  to={`/brands/${encodeURIComponent(brand.slug)}`}
                >
                  <div>
                    <h2>{brand.name}</h2>
                    <p>{formatBrandMetadata(brand)}</p>
                  </div>
                  <div className="chip-row">
                    {brand.aliases?.slice(0, 2).map((alias) => (
                      <span key={alias} className="info-chip">
                        {alias}
                      </span>
                    ))}
                    {brand.tags?.slice(0, 2).map((tag) => (
                      <span key={tag} className="info-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <StateCard
              body={`No brands matched "${deferredQuery.trim()}".`}
              title="No matching brands"
            />
          )
        ) : null}
      </section>
    </BrandsPage>
  );
}

function BrandDetailRoutePage() {
  const { slug } = useParams();
  const [state, setState] = useState<BrandDetailRequestState>({
    status: "loading",
  });

  useEffect(() => {
    if (!slug) {
      setState({
        errorMessage: "Brand not found.",
        status: "error",
      });
      return;
    }

    const controller = new AbortController();

    setState({
      status: "loading",
    });

    void fetchJson<BrandDetailResponse>(`/brands/${encodeURIComponent(slug)}`, controller.signal)
      .then((response) => {
        setState({
          brand: response.brand,
          status: "success",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          errorMessage: error instanceof Error ? error.message : "The brand could not be loaded.",
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const brand = state.brand;

  return (
    <BrandDetailPage brandName={brand?.name}>
      {state.status === "loading" ? <LoadingListings count={4} /> : null}

      {state.status === "error" ? (
        <StateCard
          action={
            <Link className="secondary-button link-button" to="/brands">
              Back to brands
            </Link>
          }
          body={state.errorMessage ?? "The brand profile could not be loaded."}
          title="Brand unavailable"
        />
      ) : null}

      {state.status === "success" && brand ? (
        <section className="brand-detail">
          <article className="brand-detail__panel">
            <div className="brand-detail__header">
              <div>
                <h2>{brand.name}</h2>
              </div>
              <Link
                className="search-form__button link-button"
                to={buildBrandSearchPath(brand.name)}
              >
                Search this brand
              </Link>
            </div>

            {brand.aliases?.length ? (
              <div>
                <p className="brand-detail__label">Aliases</p>
                <div className="chip-row">
                  {brand.aliases.map((alias) => (
                    <span key={alias} className="info-chip">
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {brand.tags?.length ? (
              <div>
                <p className="brand-detail__label">Tags</p>
                <div className="chip-row">
                  {brand.tags.map((tag) => (
                    <span key={tag} className="info-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </article>

          <article className="brand-detail__panel">
            <h2>Shop {brand.name}</h2>
            <p>Use search to jump straight into available listings for this brand.</p>
            <div className="inline-actions">
              <Link
                className="search-form__button link-button"
                to={buildBrandSearchPath(brand.name)}
              >
                Search listings
              </Link>
              <Link className="secondary-button link-button" to="/brands">
                Back to brands
              </Link>
            </div>
          </article>
        </section>
      ) : null}
    </BrandDetailPage>
  );
}

function SignupRoutePage({
  onAuthSuccess,
  session,
}: {
  onAuthSuccess: (session: AuthResponse) => void;
  session: AuthResponse | null;
}) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(undefined);
    setIsSubmitting(true);

    try {
      const nextSession = await sendJson<AuthResponse>("/auth/signup", "POST", {
        username,
        password,
      });

      onAuthSuccess(nextSession);

      startTransition(() => {
        navigate("/onboarding");
      });
    } catch (error: unknown) {
      setErrorMessage(getAuthErrorMessage(error, "Signup failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPage
      description="Create your account to save likes and shape your feed."
      title="Create Your Account"
    >
      {session ? (
        <StateCard
          action={
            <Link className="search-form__button link-button" to="/profile">
              Go to profile
            </Link>
          }
          body="You are already signed in."
          title="Already signed in"
        />
      ) : (
        <form className="account-form" onSubmit={handleSubmit}>
          <label className="field-group" htmlFor="signup-username">
            <span>Username</span>
            <input
              id="signup-username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="archivekid"
              value={username}
            />
          </label>

          <label className="field-group" htmlFor="signup-password">
            <span>Password</span>
            <input
              id="signup-password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              type="password"
              value={password}
            />
          </label>

          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

          <div className="search-panel__actions">
            <button className="search-form__button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating account..." : "Create account"}
            </button>
            <Link className="secondary-button link-button" to="/login">
              Already have an account?
            </Link>
          </div>
        </form>
      )}
    </AuthPage>
  );
}

function LoginRoutePage({
  onAuthSuccess,
  session,
}: {
  onAuthSuccess: (session: AuthResponse) => void;
  session: AuthResponse | null;
}) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(undefined);
    setIsSubmitting(true);

    try {
      const nextSession = await sendJson<AuthResponse>("/auth/login", "POST", {
        username,
        password,
      });

      onAuthSuccess(nextSession);

      startTransition(() => {
        navigate(hasCompletedOnboarding(nextSession) ? "/profile" : "/onboarding");
      });
    } catch (error: unknown) {
      setErrorMessage(getAuthErrorMessage(error, "Login failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPage description="Log in to pick up your saved likes and preferences." title="Log In">
      {session ? (
        <StateCard
          action={
            <Link className="search-form__button link-button" to="/profile">
              Go to profile
            </Link>
          }
          body="You are already signed in."
          title="Already signed in"
        />
      ) : (
        <form className="account-form" onSubmit={handleSubmit}>
          <label className="field-group" htmlFor="login-username">
            <span>Username</span>
            <input
              id="login-username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="archivekid"
              value={username}
            />
          </label>

          <label className="field-group" htmlFor="login-password">
            <span>Password</span>
            <input
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              type="password"
              value={password}
            />
          </label>

          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

          <div className="search-panel__actions">
            <button className="search-form__button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Logging in..." : "Log in"}
            </button>
            <Link className="secondary-button link-button" to="/signup">
              Need an account?
            </Link>
            <Link className="secondary-button link-button" to="/forgot-password">
              Forgot password?
            </Link>
          </div>
        </form>
      )}
    </AuthPage>
  );
}

function OnboardingRoutePage({
  onAuthFailure,
  onSessionChange,
  session,
}: {
  onAuthFailure: () => void;
  onSessionChange: (session: AuthResponse) => void;
  session: AuthResponse | null;
}) {
  const navigate = useNavigate();
  const [favoriteBrands, setFavoriteBrands] = useState("");
  const [categories, setCategories] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFavoriteBrands(session?.user.onboardingPreferences.favoriteBrands.join(", ") ?? "");
    setCategories(session?.user.onboardingPreferences.categories.join(", ") ?? "");
    setPriceRange(session?.user.onboardingPreferences.priceRange ?? "");
  }, [session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      return;
    }

    setErrorMessage(undefined);
    setIsSubmitting(true);

    try {
      const nextSession = await sendJson<AuthResponse>("/users/onboarding", "POST", {
        preferences: {
          favoriteBrands: parseCommaSeparatedList(favoriteBrands),
          categories: parseCommaSeparatedList(categories),
          priceRange: priceRange.trim(),
        },
      });

      onSessionChange(nextSession);

      startTransition(() => {
        navigate("/");
      });
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        startTransition(() => {
          navigate("/login");
        });
      }

      setErrorMessage(getAuthErrorMessage(error, "Preferences could not be saved."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <OnboardingPage>
      {!session ? (
        <StateCard
          action={
            <div className="inline-actions">
              <Link className="search-form__button link-button" to="/signup">
                Sign up
              </Link>
              <Link className="secondary-button link-button" to="/login">
                Log in
              </Link>
            </div>
          }
          body="Create an account or log in before saving preferences."
          title="Onboarding needs an account"
        />
      ) : (
        <form className="account-form" onSubmit={handleSubmit}>
          <label className="field-group" htmlFor="onboarding-brands">
            <span>Favorite brands</span>
            <input
              id="onboarding-brands"
              onChange={(event) => setFavoriteBrands(event.target.value)}
              placeholder="Our Legacy, Helmut Lang, Acne Studios"
              value={favoriteBrands}
            />
          </label>

          <label className="field-group" htmlFor="onboarding-categories">
            <span>Categories</span>
            <input
              id="onboarding-categories"
              onChange={(event) => setCategories(event.target.value)}
              placeholder="jackets, knitwear, pants"
              value={categories}
            />
          </label>

          <label className="field-group" htmlFor="onboarding-price-range">
            <span>Price preference</span>
            <input
              id="onboarding-price-range"
              onChange={(event) => setPriceRange(event.target.value)}
              placeholder="$100-$300"
              value={priceRange}
            />
          </label>

          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

          <div className="search-panel__actions">
            <button className="search-form__button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Saving..." : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </OnboardingPage>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(() => typeof window !== "undefined");
  const [sessionNotice, setSessionNotice] = useState<string | undefined>();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const controller = new AbortController();

    void loadUserSession(controller.signal)
      .then((nextSession) => {
        setSession(nextSession);
        setIsSessionLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSession(null);
          setIsSessionLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  function handleSessionChange(nextSession: AuthResponse) {
    setSession(nextSession);
    setIsSessionLoading(false);
    setSessionNotice(undefined);
  }

  function handleSessionExpired() {
    setSession(null);
    setIsSessionLoading(false);
    setSessionNotice(
      "Your session expired or you were signed out. Log in again to keep saving likes, searches, and watchlists.",
    );
  }

  function handleAccountDeleted() {
    setSession(null);
    setIsSessionLoading(false);
    setSessionNotice("Your account and its stored data were deleted.");

    startTransition(() => {
      navigate("/");
    });
  }

  function handlePasswordReset() {
    setSession(null);
    setIsSessionLoading(false);
    setSessionNotice("Your password was updated and all sessions were revoked. Log in again.");
  }

  function handleLogout() {
    void sendJson<{ success: boolean }>("/auth/logout", "POST", {})
      .catch(() => undefined)
      .finally(() => {
        setSession(null);
        setIsSessionLoading(false);
        setSessionNotice("You have been logged out.");

        startTransition(() => {
          navigate("/");
        });
      });
  }

  return (
    <div className="app-shell">
      <ScrollPositionRestoration />
      <header className="topbar">
        <Link className="topbar-mark" to="/">
          <div className="mark-badge" aria-hidden="true">
            CS
          </div>
          <div>
            <p className="brand-kicker">ClosetSearch</p>
            <h1>Fashion resale discovery</h1>
          </div>
        </Link>
        <GlobalSearchBar />
        <div className="topbar-actions">
          {isSessionLoading ? (
            <span className="info-chip">Loading session...</span>
          ) : session ? (
            <div className="session-pill">
              <span>@{session.user.username}</span>
              <button
                className="secondary-button session-pill__button"
                onClick={handleLogout}
                type="button"
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="inline-actions">
              <Link className="secondary-button link-button" to="/login">
                Log in
              </Link>
              <Link className="search-form__button link-button" to="/signup">
                Sign up
              </Link>
            </div>
          )}
        </div>
      </header>

      <nav aria-label="Primary" className="primary-nav">
        <div className="primary-nav__scroll">
          {primaryNavigationItems.map((item) => (
            <NavLink
              key={item.path}
              className={({ isActive }) => (isActive ? "nav-pill nav-pill--active" : "nav-pill")}
              end={item.path === "/"}
              to={item.path}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="page-main">
        {sessionNotice ? (
          <section className="inline-banner">
            <p>{sessionNotice}</p>
            {!session ? (
              <div className="inline-actions">
                <Link className="secondary-button link-button" to="/login">
                  Log in again
                </Link>
                <button
                  className="secondary-button"
                  onClick={() => setSessionNotice(undefined)}
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        <Routes>
          <Route
            element={<HomePage onAuthFailure={handleSessionExpired} session={session} />}
            path="/"
          />
          <Route
            element={<SearchRoutePage onAuthFailure={handleSessionExpired} session={session} />}
            path="/search"
          />
          <Route
            element={
              <RecentSearchesRoutePage onAuthFailure={handleSessionExpired} session={session} />
            }
            path="/recent-searches"
          />
          <Route element={<AnalyticsRoutePage session={session} />} path="/analytics" />
          <Route
            element={
              <ProfileRoutePage
                onAccountDeleted={handleAccountDeleted}
                onAuthFailure={handleSessionExpired}
                session={session}
              />
            }
            path="/profile"
          />
          <Route
            element={<AlertInboxPage onAuthFailure={handleSessionExpired} session={session} />}
            path="/alerts"
          />
          <Route element={<BetaInfoRoutePage />} path="/beta" />
          <Route
            element={<SignupRoutePage onAuthSuccess={handleSessionChange} session={session} />}
            path="/signup"
          />
          <Route
            element={<LoginRoutePage onAuthSuccess={handleSessionChange} session={session} />}
            path="/login"
          />
          <Route element={<PasswordResetRequestPage />} path="/forgot-password" />
          <Route
            element={<PasswordResetCompletePage onPasswordReset={handlePasswordReset} />}
            path="/reset-password"
          />
          <Route element={<EmailVerificationPage />} path="/verify-email" />
          <Route element={<AccountExportPage />} path="/account/export" />
          <Route
            element={
              <OnboardingRoutePage
                onAuthFailure={handleSessionExpired}
                onSessionChange={handleSessionChange}
                session={session}
              />
            }
            path="/onboarding"
          />
          <Route element={<BrandsRoutePage />} path="/brands" />
          <Route element={<BrandDetailRoutePage />} path="/brands/:slug" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </main>

      <footer className="page-shell">
        <section className="state-card">
          <h2>Constrained beta</h2>
          <p>
            Observed-data analytics only. In-app alerts require the production PostgreSQL worker.
            Privacy, data use, known limits, and beta feedback guidance are available in the beta
            information page.
          </p>
          <div className="inline-actions">
            <Link className="secondary-button link-button" to="/beta">
              Beta information
            </Link>
            <a
              className="secondary-button link-button"
              href={betaFeedbackUrl}
              rel="noreferrer"
              target="_blank"
            >
              Share feedback
            </a>
          </div>
        </section>
      </footer>

      <nav aria-label="Bottom navigation" className="bottom-nav">
        <div className="bottom-nav__bar">
          {primaryNavigationItems.map((item) => (
            <NavLink
              key={item.path}
              className={({ isActive }) =>
                isActive ? "bottom-link bottom-link--active" : "bottom-link"
              }
              end={item.path === "/"}
              to={item.path}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
