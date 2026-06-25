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
  FeedResponse,
  Like,
  Listing,
  MarketInsight,
  PremiumAccess,
  SearchResponse,
  SearchSortMode,
  UnderpricedListingSignal,
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
import { ListingCard } from "./components/listing-card";
import {
  buildSearchPath,
  clearRecentSearches,
  createDefaultSearchFormValues,
  createSearchParams,
  describeSearch,
  loadRecentSearches,
  parseSearchFormValues,
  saveRecentSearch,
  type RecentSearchEntry,
  type SearchFormValues,
} from "./search-utils";
import { clearUserSession, loadUserSession, saveUserSession } from "./user-session";

const primaryNavigationItems = [
  { label: "Home", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Brands", path: "/brands" },
  { label: "Analytics", path: "/analytics" },
  { label: "Profile", path: "/profile" },
] as const;

const homeFeedPageSize = 4;
const sortOptions: Array<{ label: string; value: SearchSortMode }> = [
  { label: "Relevance", value: "relevance" },
  { label: "Price low to high", value: "price_asc" },
  { label: "Price high to low", value: "price_desc" },
  { label: "Newest first", value: "newest" },
];
const sourceOptions = [
  { label: "All marketplaces", value: "" },
  { label: "Mock Closet", value: "mock" },
];
const listingTypeOptions = [
  { label: "All listing types", value: "" },
  { label: "Fixed price", value: "buy_now" },
  { label: "Auction", value: "auction" },
];
interface PageTemplateProps {
  title?: string;
  description?: string;
  children?: ReactNode;
}

interface FeedRequestState {
  errorMessage?: string;
  hasMore: boolean;
  isPersonalized: boolean;
  isLoadingMore: boolean;
  listings: Listing[];
  loadMoreErrorMessage?: string;
  nextPage?: number;
  status: "loading" | "success" | "error";
  total: number;
}

interface SearchRequestState {
  errorMessage?: string;
  response?: SearchResponse;
  status: "idle" | "loading" | "success" | "error";
}

interface LikeResponse {
  like: Like;
}

interface LikesResponse {
  likes: Like[];
  userId: string;
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
  premiumPreviewUsername?: string;
  sampleData?: boolean;
}

interface MarketInsightsResponse {
  locked: boolean;
  insights?: MarketInsight[];
  message?: string;
  premiumAccess?: PremiumAccess;
  premiumPreviewUsername?: string;
  sampleData?: boolean;
}

interface UnderpricedSignalsResponse {
  locked: boolean;
  message?: string;
  premiumAccess?: PremiumAccess;
  premiumPreviewUsername?: string;
  sampleData?: boolean;
  signals?: UnderpricedListingSignal[];
}

interface AnalyticsRequestState {
  errorMessage?: string;
  insights: MarketInsight[];
  locked: boolean;
  message?: string;
  overview?: AnalyticsOverview;
  premiumAccess?: PremiumAccess;
  premiumPreviewUsername?: string;
  sampleData: boolean;
  signals: UnderpricedListingSignal[];
  status: "loading" | "success" | "error";
}

function PageTemplate({
  title,
  description,
  children,
}: PageTemplateProps) {
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

function StateCard({
  action,
  body,
  title,
}: {
  action?: ReactNode;
  body: string;
  title: string;
}) {
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

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}% confidence`;
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

function useLikes(userId?: string) {
  const [likes, setLikes] = useState<Like[]>([]);

  useEffect(() => {
    if (!userId) {
      setLikes([]);
      return;
    }

    const controller = new AbortController();

    void fetchJson<LikesResponse>(`/likes/${userId}`, controller.signal)
      .then((response) => {
        setLikes(response.likes);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLikes([]);
        }
      });

    return () => {
      controller.abort();
    };
  }, [userId]);

  async function toggleLike(listing: Listing, nextLiked: boolean) {
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

      setLikes((currentLikes) => {
        if (currentLikes.some((like) => like.listingId === listing.id)) {
          return currentLikes;
        }

        return [optimisticLike, ...currentLikes];
      });

      try {
        const response = await sendJson<LikeResponse>("/likes", "POST", {
          userId,
          listingId: listing.id,
          source: listing.source.id,
        });

        setLikes((currentLikes) => {
          const remainingLikes = currentLikes.filter(
            (like) => like.listingId !== response.like.listingId,
          );

          return [response.like, ...remainingLikes];
        });
      } catch (error) {
        setLikes((currentLikes) =>
          currentLikes.filter((like) => like.listingId !== listing.id),
        );
        throw error;
      }

      return;
    }

    const existingLike = likes.find((like) => like.listingId === listing.id);

    setLikes((currentLikes) =>
      currentLikes.filter((like) => like.listingId !== listing.id),
    );

    try {
      await sendJson<{ removed: boolean }>("/likes", "DELETE", {
        userId,
        listingId: listing.id,
      });
    } catch (error) {
      if (existingLike) {
        setLikes((currentLikes) => {
          if (currentLikes.some((like) => like.listingId === existingLike.listingId)) {
            return currentLikes;
          }

          return [existingLike, ...currentLikes];
        });
      }

      throw error;
    }
  }

  return {
    likes,
    likedListingIds: new Set(likes.map((like) => like.listingId)),
    toggleLike,
  };
}

function ListingGrid({
  listings,
  likedListingIds,
  onToggleLike,
}: {
  listings: Listing[];
  likedListingIds?: Set<string>;
  onToggleLike?: (listing: Listing, nextLiked: boolean) => Promise<void>;
}) {
  return (
    <div className="listing-grid">
      {listings.map((listing) => (
        <ListingCard
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

    startTransition(() => {
      navigate(
        buildSearchPath({
          ...createDefaultSearchFormValues(),
          query,
        }),
      );
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

function HomePage({ session }: { session: AuthResponse | null }) {
  const navigate = useNavigate();
  const { likedListingIds, toggleLike } = useLikes(session?.userId);
  const [reloadCount, setReloadCount] = useState(0);
  const needsPreferenceReminder = Boolean(session) && !hasCompletedOnboarding(session);
  const [state, setState] = useState<FeedRequestState>({
    hasMore: false,
    isPersonalized: false,
    isLoadingMore: false,
    listings: [],
    status: "loading",
    total: 0,
  });

  useEffect(() => {
    const controller = new AbortController();

    setState({
      hasMore: false,
      isPersonalized: false,
      isLoadingMore: false,
      listings: [],
      status: "loading",
      total: 0,
    });

    const feedParams = new URLSearchParams({
      page: "1",
      pageSize: String(homeFeedPageSize),
    });

    if (session?.userId) {
      feedParams.set("userId", session.userId);
    }

    void fetchJson<FeedResponse>(`/feed?${feedParams.toString()}`, controller.signal)
      .then((response) => {
        setState({
          hasMore: response.hasMore,
          isPersonalized: response.isPersonalized,
          isLoadingMore: false,
          listings: response.listings,
          nextPage: response.nextPage,
          status: "success",
          total: response.total,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          errorMessage:
            error instanceof Error ? error.message : "The feed request failed.",
          hasMore: false,
          isPersonalized: false,
          isLoadingMore: false,
          listings: [],
          status: "error",
          total: 0,
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
    if (!state.nextPage || state.isLoadingMore) {
      return;
    }

    setState((currentState) => ({
      ...currentState,
      isLoadingMore: true,
      loadMoreErrorMessage: undefined,
    }));

    const feedParams = new URLSearchParams({
      page: String(state.nextPage),
      pageSize: String(homeFeedPageSize),
    });

    if (session?.userId) {
      feedParams.set("userId", session.userId);
    }

    void fetchJson<FeedResponse>(`/feed?${feedParams.toString()}`)
      .then((response) => {
        setState((currentState) => ({
          ...currentState,
          hasMore: response.hasMore,
          isPersonalized: response.isPersonalized,
          isLoadingMore: false,
          listings: [...currentState.listings, ...response.listings],
          nextPage: response.nextPage,
          total: response.total,
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

    await toggleLike(listing, nextLiked);

    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  const introCopy = session
    ? "Based on your likes and preferences."
    : "Popular finds across resale marketplaces.";

  return (
    <section className="page-shell page-shell--home">
      <header className="market-header">
        <div>
          <h1>Find your next piece</h1>
          <p className="page-description">{introCopy}</p>
        </div>
        <div className="chip-row chip-row--tabs">
          <span className="info-chip info-chip--accent">{session ? "For You" : "Trending"}</span>
          <span className="info-chip">New Finds</span>
          <span className="info-chip">{state.total > 0 ? `${state.total} listings` : "Fresh updates"}</span>
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

      {state.status === "loading" ? <LoadingListings /> : null}

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
              ? "There is nothing to show right now. Save a few likes or come back when new listings arrive."
              : "There are no listings to show right now. Check back soon for fresh finds."
          }
          title="Nothing here yet"
        />
      ) : null}

      {state.status === "success" && state.listings.length > 0 ? (
        <>
          <ListingGrid
            likedListingIds={likedListingIds}
            listings={state.listings}
            onToggleLike={handleToggleLike}
          />
          {state.loadMoreErrorMessage ? (
            <StateCard body={state.loadMoreErrorMessage} title="Could not load more listings" />
          ) : null}
          {state.hasMore ? (
            <div className="feed-results__footer">
              <button
                className="load-more-button"
                disabled={state.isLoadingMore}
                onClick={handleLoadMore}
                type="button"
              >
                {state.isLoadingMore ? "Loading more..." : "Load more"}
              </button>
            </div>
          ) : null}
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
      description="Preview sample pricing context, brand movement, and under-market signals."
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

function BrandsPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate title="Brands" description="Browse labels, aliases, and style tags.">
      {children}
    </PageTemplate>
  );
}

function BrandDetailPage({
  brandName,
  children,
}: {
  brandName?: string;
  children?: ReactNode;
}) {
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
  onSubmit,
}: {
  initialValues: SearchFormValues;
  onSubmit: (values: SearchFormValues) => void;
}) {
  const [values, setValues] = useState(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [
    initialValues.listingType,
    initialValues.maxPrice,
    initialValues.minPrice,
    initialValues.query,
    initialValues.sort,
    initialValues.source,
  ]);

  function updateValue<Key extends keyof SearchFormValues>(
    key: Key,
    value: SearchFormValues[Key],
  ) {
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(values);
  }

  function handleClear() {
    const nextValues = createDefaultSearchFormValues();
    setValues(nextValues);
    onSubmit(nextValues);
  }

  return (
    <form className="search-panel" onSubmit={handleSubmit}>
      <div className="search-panel__header">
        <div>
          <h2>Search the marketplace</h2>
          <p>Search brands, pieces, and styles, then narrow the results with a few quick filters.</p>
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
            {sourceOptions.map((option) => (
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
    </form>
  );
}

function SearchResults({
  likedListingIds,
  onRetry,
  onToggleLike,
  query,
  state,
  summary,
}: {
  likedListingIds: Set<string>;
  onRetry: () => void;
  onToggleLike: (listing: Listing, nextLiked: boolean) => Promise<void>;
  query: string;
  state: SearchRequestState;
  summary: string;
}) {
  if (state.status === "idle") {
    return <StateCard body="Start with a search to see listings here." title="Search the marketplace" />;
  }

  if (state.status === "loading") {
    return <LoadingListings count={10} />;
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

  if (!response || response.listings.length === 0) {
    return (
      <StateCard
        body={`No results found for "${query}". Try broadening your search or clearing a filter.`}
        title="No results found"
      />
    );
  }

  return (
    <section className="search-results">
      <div className="section-heading">
        <div>
          <h2>{response.total} listings</h2>
          <p>Results for "{response.query.text}".</p>
        </div>
        <div className="chip-row">
          <span className="info-chip">{summary}</span>
          <span className="info-chip">{response.providers.map((provider) => provider.providerName).join(", ")}</span>
        </div>
      </div>

      <ListingGrid
        likedListingIds={likedListingIds}
        listings={response.listings}
        onToggleLike={onToggleLike}
      />
    </section>
  );
}

function SearchRoutePage({ session }: { session: AuthResponse | null }) {
  const navigate = useNavigate();
  const { likedListingIds, toggleLike } = useLikes(session?.userId);
  const [searchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const values = parseSearchFormValues(searchParams);
  const query = values.query;
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<SearchRequestState>({
    status: query.length > 0 ? "loading" : "idle",
  });

  useEffect(() => {
    if (query.length === 0) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    const requestParams = createSearchParams(values);

    setState({ status: "loading" });

    void fetchJson<SearchResponse>(`/search?${requestParams.toString()}`, controller.signal)
      .then((response) => {
        setState({
          response,
          status: "success",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          errorMessage:
            error instanceof Error ? error.message : "Search request failed.",
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    query,
    reloadCount,
    searchKey,
    values.listingType,
    values.maxPrice,
    values.minPrice,
    values.sort,
    values.source,
  ]);

  useEffect(() => {
    if (state.status === "success" && query.length > 0) {
      saveRecentSearch(values);
    }
  }, [
    query,
    state.status,
    values.listingType,
    values.maxPrice,
    values.minPrice,
    values.query,
    values.sort,
    values.source,
  ]);

  function handleSubmit(nextValues: SearchFormValues) {
    startTransition(() => {
      navigate(buildSearchPath(nextValues));
    });
  }

  function handleRetry() {
    startTransition(() => {
      setReloadCount((currentValue) => currentValue + 1);
    });
  }

  async function handleToggleLike(listing: Listing, nextLiked: boolean) {
    if (!session) {
      startTransition(() => {
        navigate("/login");
      });
      return;
    }

    await toggleLike(listing, nextLiked);
  }

  return (
    <SearchPage>
      <section className="search-layout">
        <SearchControlPanel initialValues={values} onSubmit={handleSubmit} />
        <SearchResults
          likedListingIds={likedListingIds}
          onRetry={handleRetry}
          onToggleLike={handleToggleLike}
          query={query}
          state={state}
          summary={describeSearch(values)}
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

function RecentSearchesRoutePage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RecentSearchEntry[]>([]);

  useEffect(() => {
    setEntries(loadRecentSearches());
  }, []);

  function handleClear() {
    clearRecentSearches();
    setEntries([]);
  }

  function handleRunSearch(params: string) {
    startTransition(() => {
      navigate(`/search?${params}`);
    });
  }

  return (
    <RecentSearchesPage>
      <section className="recent-searches">
        {entries.length === 0 ? (
          <StateCard body="Run a few searches and they will show up here." title="No recent searches yet" />
        ) : (
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
        )}
      </section>
    </RecentSearchesPage>
  );
}

function AnalyticsRoutePage({ session }: { session: AuthResponse | null }) {
  const [state, setState] = useState<AnalyticsRequestState>({
    insights: [],
    locked: true,
    sampleData: false,
    signals: [],
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();

    if (session?.userId) {
      params.set("userId", session.userId);
    }

    const query = params.toString();
    const suffix = query.length > 0 ? `?${query}` : "";

    setState({
      insights: [],
      locked: true,
      sampleData: false,
      signals: [],
      status: "loading",
    });

    void fetchJson<AnalyticsOverviewResponse>(`/analytics/overview${suffix}`, controller.signal)
      .then(async (overviewResponse) => {
        if (overviewResponse.locked) {
          setState({
            insights: [],
            locked: true,
            message: overviewResponse.message,
            overview: overviewResponse.overview,
            premiumAccess: overviewResponse.premiumAccess,
            premiumPreviewUsername: overviewResponse.premiumPreviewUsername,
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
          insights: insightsResponse.insights ?? [],
          locked: false,
          message: overviewResponse.message,
          overview: overviewResponse.overview,
          premiumAccess: overviewResponse.premiumAccess,
          premiumPreviewUsername: overviewResponse.premiumPreviewUsername,
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
          errorMessage:
            error instanceof Error ? error.message : "The analytics preview could not be loaded.",
          insights: [],
          locked: true,
          sampleData: false,
          signals: [],
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [session?.userId]);

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
          body={state.errorMessage ?? "The analytics preview could not be loaded."}
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
              <h2>Premium analytics preview</h2>
              <p className="page-description">
                {state.message ??
                  "Pricing context, market insights, and under-market signals are still sample-only preview surfaces."}
              </p>
            </div>
            <div className="chip-row">
              <span className="info-chip info-chip--accent">Premium</span>
              <span className="info-chip">Preview-only access</span>
            </div>
          </section>

          <div className="analytics-preview-grid">
            {[
              "Track resale pricing",
              "Spot listings below typical market ranges",
              "Compare brand demand",
              "Watch pricing shifts",
            ].map((title) => (
              <article key={title} className="analytics-preview-card analytics-preview-card--locked">
                <h2>{title}</h2>
              </article>
            ))}
          </div>

          <p className="analytics-note">
            {state.premiumPreviewUsername
              ? `Local preview access is available with ${state.premiumPreviewUsername}.`
              : "Preview access is limited to a local sample account for now."}
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
            <h2>{state.premiumAccess?.planName ?? "Premium analytics"}</h2>
            <p className="page-description">
              Explore sample pricing signals, brand movement, and underpriced listing ideas.
            </p>
          </div>
          <div className="chip-row">
            <span className="info-chip info-chip--accent">Premium preview</span>
            {state.sampleData ? <span className="info-chip">Sample data</span> : null}
          </div>
        </section>

        {state.overview ? (
          <div className="analytics-overview-grid">
            <article className="analytics-stat-card">
              <p className="eyebrow">Tracked brands</p>
              <h2>{state.overview.trackedBrands}</h2>
            </article>
            <article className="analytics-stat-card">
              <p className="eyebrow">Market insights</p>
              <h2>{state.overview.marketInsightCount}</h2>
            </article>
            <article className="analytics-stat-card">
              <p className="eyebrow">Underpriced signals</p>
              <h2>{state.overview.underpricedSignalCount}</h2>
            </article>
          </div>
        ) : null}

        <section className="analytics-section">
          <div className="section-heading">
            <h2>Market insights</h2>
          </div>
          <div className="analytics-card-grid">
            {state.insights.map((insight) => (
              <article key={insight.id} className="analytics-data-card">
                <div className="analytics-data-card__header">
                  <div>
                    <p className="eyebrow">{insight.brand.name}</p>
                    <h2>{insight.title}</h2>
                  </div>
                  <span className="info-chip">{insight.category}</span>
                </div>
                <p>{insight.summary}</p>
                <div className="chip-row">
                  <span className="info-chip">{formatConfidence(insight.confidence)}</span>
                  <span className="info-chip">{formatRecentSearchDate(insight.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="analytics-section">
          <div className="section-heading">
            <h2>Underpriced signals</h2>
          </div>
          <div className="analytics-card-grid">
            {state.signals.map((signal) => (
              <article key={signal.id} className="analytics-data-card">
                <div className="analytics-data-card__header">
                  <div>
                    <p className="eyebrow">{signal.source}</p>
                    <h2>{signal.listingTitle}</h2>
                  </div>
                  <span className="info-chip info-chip--accent">{signal.percentBelowMarket}% below</span>
                </div>
                <p>{signal.reason}</p>
                <div className="analytics-pricing-row">
                  <div>
                    <span>Current</span>
                    <strong>{formatCurrencyAmount(signal.currentPrice, signal.currency)}</strong>
                  </div>
                  <div>
                    <span>Typical</span>
                    <strong>{formatCurrencyAmount(signal.estimatedMarketPrice, signal.currency)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </AnalyticsPage>
  );
}

function ProfileRoutePage({ session }: { session: AuthResponse | null }) {
  const { likes } = useLikes(session?.userId);

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
          body="Log in or create an account to save preferences and likes."
          title="Profile needs an account"
        />
      </ProfilePage>
    );
  }

  const preferences = session.user.onboardingPreferences;

  return (
    <ProfilePage>
      <section className="profile-grid">
        <article className="profile-panel">
          <p className="eyebrow">Account</p>
          <h2>{session.user.username}</h2>
          <p>Joined {formatRecentSearchDate(session.user.createdAt)}.</p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Saved pieces</p>
          <h2>{likes.length}</h2>
          <p>
            {likes.length > 0
              ? "Your likes are ready to shape the feed."
              : "Like a few listings from home or search to start shaping your feed."}
          </p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Preferences</p>
          <h2>{preferences.priceRange || "No price range yet"}</h2>
          <p>
            Brands: {preferences.favoriteBrands.join(", ") || "None yet"}
            <br />
            Categories: {preferences.categories.join(", ") || "None yet"}
          </p>
        </article>
      </section>
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
          errorMessage:
            error instanceof Error ? error.message : "Brand browsing is unavailable.",
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
          errorMessage:
            error instanceof Error ? error.message : "The brand could not be loaded.",
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
      setErrorMessage(error instanceof Error ? error.message : "Signup failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPage description="Create your account to save likes and shape your feed." title="Create Your Account">
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
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 4 characters"
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
      setErrorMessage(error instanceof Error ? error.message : "Login failed.");
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
          </div>
        </form>
      )}
    </AuthPage>
  );
}

function OnboardingRoutePage({
  onSessionChange,
  session,
}: {
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
        userId: session.userId,
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
      setErrorMessage(error instanceof Error ? error.message : "Preferences could not be saved.");
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
  const [session, setSession] = useState<AuthResponse | null>(() => loadUserSession());

  function handleSessionChange(nextSession: AuthResponse) {
    saveUserSession(nextSession);
    setSession(nextSession);
  }

  function handleLogout() {
    clearUserSession();
    setSession(null);

    startTransition(() => {
      navigate("/");
    });
  }

  return (
    <div className="app-shell">
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
          {session ? (
            <div className="session-pill">
              <span>@{session.user.username}</span>
              <button className="secondary-button session-pill__button" onClick={handleLogout} type="button">
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
              className={({ isActive }) =>
                isActive ? "nav-pill nav-pill--active" : "nav-pill"
              }
              end={item.path === "/"}
              to={item.path}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="page-main">
        <Routes>
          <Route element={<HomePage session={session} />} path="/" />
          <Route element={<SearchRoutePage session={session} />} path="/search" />
          <Route element={<RecentSearchesRoutePage />} path="/recent-searches" />
          <Route element={<AnalyticsRoutePage session={session} />} path="/analytics" />
          <Route element={<ProfileRoutePage session={session} />} path="/profile" />
          <Route
            element={<SignupRoutePage onAuthSuccess={handleSessionChange} session={session} />}
            path="/signup"
          />
          <Route
            element={<LoginRoutePage onAuthSuccess={handleSessionChange} session={session} />}
            path="/login"
          />
          <Route
            element={<OnboardingRoutePage onSessionChange={handleSessionChange} session={session} />}
            path="/onboarding"
          />
          <Route element={<BrandsRoutePage />} path="/brands" />
          <Route element={<BrandDetailRoutePage />} path="/brands/:slug" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </main>

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
