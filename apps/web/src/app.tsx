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

const brandDirectoryLink = {
  label: "Browse brands",
  path: "/brands",
} as const;

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
  eyebrow: string;
  title: string;
  description: string;
  highlightLabel: string;
  highlightValue: string;
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
  eyebrow,
  title,
  description,
  highlightLabel,
  highlightValue,
  children,
}: PageTemplateProps) {
  return (
    <section className="page-shell">
      <article className="page-card">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
          <div className="page-highlight">
            <span>{highlightLabel}</span>
            <strong>{highlightValue}</strong>
          </div>
        </div>
        <p className="page-description">{description}</p>
      </article>
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

  let feedContent: ReactNode;

  if (state.status === "loading") {
    feedContent = (
      <section className="feed-results">
        <article
          className={
            session ? "feed-hero-card feed-hero-card--personalized" : "feed-hero-card"
          }
        >
          <div className="feed-hero-card__copy">
            <p className="eyebrow">{session ? "For You" : "Discovery"}</p>
            <h2>{session ? "Building your feed" : "Loading discovery feed"}</h2>
            <p>
              {session
                ? "Recommended from your likes and preferences, with a little exploration mixed in."
                : "Pulling the latest normalized listings from the default discovery feed."}
            </p>
          </div>
          <div className="feed-loading-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </article>
      </section>
    );
  } else if (state.status === "error") {
    feedContent = (
      <StateCard
        action={
          <button className="secondary-button" onClick={handleRetry} type="button">
            Try again
          </button>
        }
        body={state.errorMessage ?? "The feed request could not be completed."}
        title="Feed unavailable"
      />
    );
  } else if (state.listings.length === 0) {
    feedContent = (
      <section className="feed-results">
        <article
          className={
            session ? "feed-hero-card feed-hero-card--personalized" : "feed-hero-card"
          }
        >
          <div className="feed-hero-card__copy">
            <p className="eyebrow">{session ? "For You" : "Discovery"}</p>
            <h2>{session ? "Your feed is warming up" : "Nothing in the feed yet"}</h2>
            <p>
              {session
                ? "There are no listings to rank right now. Try adding a few preferences or come back after the feed refreshes."
                : "The signed-out discovery feed does not have any listings to show yet."}
            </p>
          </div>
        </article>
        {needsPreferenceReminder ? (
          <article className="feed-reminder-card">
            <div>
              <p className="eyebrow">Preferences reminder</p>
              <h3>Add a few style signals</h3>
              <p>
                Pick favorite brands or categories to make your For You feed feel more tailored.
              </p>
            </div>
            <Link className="secondary-button link-button" to="/onboarding">
              Update preferences
            </Link>
          </article>
        ) : null}
      </section>
    );
  } else {
    feedContent = (
      <section className="feed-results">
        <article
          className={
            session ? "feed-hero-card feed-hero-card--personalized" : "feed-hero-card"
          }
        >
          <div className="feed-hero-card__copy">
            <p className="eyebrow">{session ? "For You" : "Discovery"}</p>
            <h2>{session ? "A feed shaped around your taste" : "Fresh discovery picks"}</h2>
            <p>
              {session
                ? "Recommended from your likes and preferences, with a little exploration to keep things fresh."
                : "A clean browse of normalized listings from the default discovery feed."}
            </p>
          </div>
          <div className="feed-hero-card__meta">
            <strong>{state.total}</strong>
            <span>Listings ready</span>
          </div>
        </article>
        <div className="chip-row">
          <span className={session ? "info-chip info-chip--accent" : "info-chip"}>
            {session ? "For You" : "Discovery feed"}
          </span>
          <span className="info-chip">
            {session
              ? state.isPersonalized
                ? "Recommended from likes and preferences"
                : "Start with likes or onboarding preferences"
              : "Signed-out default ordering"}
          </span>
        </div>
        {needsPreferenceReminder ? (
          <article className="feed-reminder-card">
            <div>
              <p className="eyebrow">Preferences reminder</p>
              <h3>Make For You more personal</h3>
              <p>
                Add a few brands or categories and this feed will lean more into your style.
              </p>
            </div>
            <Link className="secondary-button link-button" to="/onboarding">
              Add preferences
            </Link>
          </article>
        ) : null}
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
      </section>
    );
  }

  return (
    <PageTemplate
      eyebrow="Milestone 7"
      title="Homepage Feed"
      description="Signed-out users still get the default discovery feed, while signed-in users can get a lightweight personalized ranking driven by onboarding preferences, likes, and controlled exploration."
      highlightLabel="Current behavior"
      highlightValue={session ? "Signed-in ranking ready" : "Default discovery feed"}
    >
      {feedContent}
    </PageTemplate>
  );
}

function SearchPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Milestone 5"
      title="Search"
      description="Use a single normalized search flow for keyword, marketplace, listing type, and price range without exposing provider-specific response data."
      highlightLabel="Active flow"
      highlightValue="Search + filters + likes"
    >
      {children}
    </PageTemplate>
  );
}

function RecentSearchesPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Milestone 5"
      title="Recent Searches"
      description="Recent searches are still stored only in browser localStorage, separate from the new account onboarding and likes work."
      highlightLabel="Storage"
      highlightValue="Local browser history only"
    >
      {children}
    </PageTemplate>
  );
}

function AnalyticsPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Premium foundation"
      title="Analytics"
      description="Premium analytics stays firmly in foundation mode: mock access rules, sample data models, and placeholder insights without subscriptions, real forecasting, or billing."
      highlightLabel="Current mode"
      highlightValue="Premium preview shell"
    >
      {children}
    </PageTemplate>
  );
}

function ProfilePage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Milestone 6"
      title="Profile"
      description="The profile surface stays lightweight for now: username, onboarding preferences, and a simple likes shell without sessions, premium logic, or personalization rules."
      highlightLabel="Current scope"
      highlightValue="Account shell only"
    >
      {children}
    </PageTemplate>
  );
}

function BrandsPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Brand browsing"
      title="Brand Directory"
      description="Browse a lightweight brand index, filter by name or style tags, and jump into the existing search flow when you want listings."
      highlightLabel="Planned surface"
      highlightValue="Directory + search handoff"
    >
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
      eyebrow="Brand browsing"
      title={brandName ?? "Brand Profile"}
      description="Keep brand browsing simple: basic identity, aliases and tags when available, and a direct handoff into the normalized search flow."
      highlightLabel="Current scope"
      highlightValue="Brand shell + search handoff"
    >
      {children}
    </PageTemplate>
  );
}

function AuthPage({
  children,
  description,
  title,
  highlightValue,
}: {
  children?: ReactNode;
  description: string;
  title: string;
  highlightValue: string;
}) {
  return (
    <PageTemplate
      eyebrow="Milestone 6"
      title={title}
      description={description}
      highlightLabel="Auth mode"
      highlightValue={highlightValue}
    >
      {children}
    </PageTemplate>
  );
}

function OnboardingPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Milestone 6"
      title="Onboarding"
      description="Collect a few simple style preferences after signup or first login so the account foundation can store useful taste signals without building recommendation logic yet."
      highlightLabel="Saved now"
      highlightValue="Brands, categories, price range"
    >
      {children}
    </PageTemplate>
  );
}

function NotFoundPage() {
  return (
    <PageTemplate
      eyebrow="Missing route"
      title="Page not found"
      description="The requested route does not exist in the current app shell."
      highlightLabel="Status"
      highlightValue="Unknown path"
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
          <p className="eyebrow">Search controls</p>
          <h2>Keyword, source, listing type, and price</h2>
        </div>
        <p>{describeSearch(values)}</p>
      </div>

      <div className="search-panel__grid">
        <label className="field-group" htmlFor="search-page-query">
          <span>Keyword</span>
          <input
            id="search-page-query"
            onChange={(event) => updateValue("query", event.target.value)}
            placeholder="Try jacket, trouser, or a brand"
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
          <span>Listing type</span>
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
          Update results
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
    return (
      <StateCard
        body="Start with a keyword, then add marketplace, listing type, price, or sort filters to run the normalized search flow."
        title="Start with a search"
      />
    );
  }

  if (state.status === "loading") {
    return (
      <StateCard
        body="Fetching normalized listings from the server-side search endpoint."
        title={`Searching for "${query}"`}
      />
    );
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
        body={`No normalized listings matched "${query}". Try widening the price range or removing a filter.`}
        title="No listings found"
      />
    );
  }

  return (
    <section className="search-results">
      <div className="section-heading">
        <h2>{response.total} normalized listings</h2>
        <p>
          Results for "{response.query.text}" from{" "}
          {response.providers.map((provider) => provider.providerName).join(", ")}.
        </p>
      </div>

      <div className="chip-row">
        <span className="info-chip">{summary}</span>
        <span className="info-chip">
          Page {response.page ?? 1}
          {response.pageSize ? ` • ${response.pageSize} per request` : ""}
        </span>
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
          <StateCard
            body="Run a few searches first and they will show up here from browser localStorage."
            title="No recent searches yet"
          />
        ) : (
          <>
            <div className="section-heading section-heading--split">
              <div>
                <h2>{entries.length} recent searches</h2>
                <p>Each search can jump straight back into the normalized search page.</p>
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
                  <p className="eyebrow">Recent query</p>
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
        <StateCard
          body="Loading the premium analytics foundation and checking preview access."
          title="Loading analytics"
        />
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
          <article className="analytics-hero-card analytics-hero-card--locked">
            <div className="analytics-hero-card__copy">
              <p className="eyebrow">Premium coming soon</p>
              <h2>Market intelligence will live here</h2>
              <p>
                {state.message ??
                  "Premium analytics is still in preview planning mode, so this page stays intentionally locked for non-premium accounts."}
              </p>
            </div>
            <div className="chip-row">
              <span className="info-chip info-chip--accent">Premium only</span>
              <span className="info-chip">No checkout yet</span>
            </div>
          </article>

          <div className="analytics-preview-grid">
            {[
              {
                title: "Market pricing signals",
                detail:
                  "Sample summaries of brand and category momentum, pricing tone, and supply shifts.",
              },
              {
                title: "Underpriced listing detection",
                detail:
                  "Placeholder flags for listings that appear below a simple market benchmark.",
              },
              {
                title: "Historical pricing context",
                detail:
                  "Future trend snapshots, benchmark ranges, and resale insight summaries.",
              },
              {
                title: "Resale insights",
                detail:
                  "Mock dashboards for what is moving quickly, softening, or drawing attention.",
              },
            ].map((card) => (
              <article key={card.title} className="analytics-preview-card analytics-preview-card--locked">
                <p className="eyebrow">Preview</p>
                <h2>{card.title}</h2>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>

          <StateCard
            body={
              state.premiumPreviewUsername
                ? `Mock premium preview is available by signing in with the sample username "${state.premiumPreviewUsername}". No subscriptions or billing are active.`
                : "Mock premium preview users can unlock sample analytics data later, without any billing flow."
            }
            title="Foundation only"
          />
        </section>
      </AnalyticsPage>
    );
  }

  return (
    <AnalyticsPage>
      <section className="analytics-shell">
        <article className="analytics-hero-card">
          <div className="analytics-hero-card__copy">
            <p className="eyebrow">Premium preview</p>
            <h2>Placeholder market intelligence dashboard</h2>
            <p>
              This sample workspace uses mock insights and pricing signals only. It is a foundation
              for future premium analytics, not a live forecasting or billing system.
            </p>
          </div>
          <div className="chip-row">
            <span className="info-chip info-chip--accent">
              {state.premiumAccess?.planName ?? "Premium preview"}
            </span>
            {state.sampleData ? <span className="info-chip">Sample data only</span> : null}
          </div>
        </article>

        {state.overview ? (
          <div className="analytics-overview-grid">
            <article className="analytics-stat-card">
              <p className="eyebrow">Tracked brands</p>
              <h2>{state.overview.trackedBrands}</h2>
              <p>Brands with placeholder market context in this preview.</p>
            </article>
            <article className="analytics-stat-card">
              <p className="eyebrow">Market insights</p>
              <h2>{state.overview.marketInsightCount}</h2>
              <p>Mock summaries of pricing tone and category movement.</p>
            </article>
            <article className="analytics-stat-card">
              <p className="eyebrow">Underpriced signals</p>
              <h2>{state.overview.underpricedSignalCount}</h2>
              <p>Sample pricing flags generated from simple benchmark assumptions.</p>
            </article>
          </div>
        ) : null}

        <section className="analytics-section">
          <div className="section-heading">
            <h2>Market insights</h2>
            <p>Sample signals that show what premium market context could look like later.</p>
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
            <p>Mock examples of how premium pricing signals might surface opportunities later.</p>
          </div>
          <div className="analytics-card-grid">
            {state.signals.map((signal) => (
              <article key={signal.id} className="analytics-data-card">
                <div className="analytics-data-card__header">
                  <div>
                    <p className="eyebrow">{signal.source}</p>
                    <h2>{signal.listingTitle}</h2>
                  </div>
                  <span className="info-chip info-chip--accent">
                    {signal.percentBelowMarket}% below
                  </span>
                </div>
                <p>{signal.reason}</p>
                <div className="analytics-pricing-row">
                  <div>
                    <span>Current</span>
                    <strong>{formatCurrencyAmount(signal.currentPrice, signal.currency)}</strong>
                  </div>
                  <div>
                    <span>Estimated market</span>
                    <strong>
                      {formatCurrencyAmount(signal.estimatedMarketPrice, signal.currency)}
                    </strong>
                  </div>
                </div>
                <div className="chip-row">
                  <span className="info-chip">{formatConfidence(signal.confidence)}</span>
                  <span className="info-chip">{formatRecentSearchDate(signal.createdAt)}</span>
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
                Sign up
              </Link>
            </div>
          }
          body="Log in or create an account to view your profile shell, saved onboarding preferences, and liked listings."
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
          <p className="eyebrow">Username</p>
          <h2>{session.user.username}</h2>
          <p>Account created {formatRecentSearchDate(session.user.createdAt)}.</p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Liked items</p>
          <h2>{likes.length} saved listings</h2>
          <p>{likes.length > 0 ? "Listing IDs are saved in memory for now." : "Like a few listings from home or search to see them reflected here."}</p>
        </article>

        <article className="profile-panel">
          <p className="eyebrow">Preferences</p>
          <h2>{preferences.priceRange || "Not set yet"}</h2>
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
        <article className="brand-search-panel">
          <div>
            <p className="eyebrow">Browse brands</p>
            <h2>Search by name, alias, or tag</h2>
          </div>
          <label className="field-group" htmlFor="brand-directory-search">
            <span>Brand search</span>
            <input
              id="brand-directory-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try Undercover, CDG, japanese, or streetwear"
              value={query}
            />
          </label>
        </article>

        {state.status === "loading" ? (
          <StateCard
            body="Loading the brand directory and matching the current search term."
            title="Loading brands"
          />
        ) : null}

        {state.status === "error" ? (
          <StateCard
            body={state.errorMessage ?? "The brand directory could not be loaded."}
            title="Brand directory unavailable"
          />
        ) : null}

        {state.status === "success" ? (
          state.brands.length > 0 ? (
            <>
              <div className="section-heading">
                <h2>{state.total} brands available</h2>
                <p>
                  Browse the curated directory, then jump into search when a brand catches your
                  eye.
                </p>
              </div>
              <div className="brand-grid">
                {state.brands.map((brand) => (
                  <Link
                    key={brand.id}
                    className="brand-card"
                    to={`/brands/${encodeURIComponent(brand.slug)}`}
                  >
                    <div>
                      <p className="eyebrow">Brand</p>
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
                    <span className="brand-card__footer">Open brand profile</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <StateCard
              body={`No brands matched "${deferredQuery.trim()}". Try a broader name, alias, or tag.`}
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
      {state.status === "loading" ? (
        <StateCard
          body="Loading brand details and preparing the search handoff."
          title="Loading brand profile"
        />
      ) : null}

      {state.status === "error" ? (
        <StateCard
          action={
            <Link className="secondary-button link-button" to="/brands">
              Back to directory
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
                <p className="eyebrow">Brand profile</p>
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
            <p className="eyebrow">Listings</p>
            <h2>Search handoff ready</h2>
            <p>
              This first brand detail view stays intentionally lightweight. Use the search handoff
              to explore current listings for {brand.name} through the normalized search flow.
            </p>
            <div className="inline-actions">
              <Link
                className="search-form__button link-button"
                to={buildBrandSearchPath(brand.name)}
              >
                Search listings
              </Link>
              <Link className="secondary-button link-button" to="/brands">
                Back to directory
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
    <AuthPage
      description="Create a simple ClosetSearch account with username and password. This flow stays intentionally light and browser-driven for the milestone."
      highlightValue="Signup"
      title="Sign Up"
    >
      {session ? (
        <StateCard
          action={
            <Link className="search-form__button link-button" to="/profile">
              Go to profile
            </Link>
          }
          body="You already have an active local account session in this browser."
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
    <AuthPage
      description="Log in with the lightweight username/password flow created for this milestone. No JWTs, sessions, or premium logic are mixed in."
      highlightValue="Login"
      title="Log In"
    >
      {session ? (
        <StateCard
          action={
            <Link className="search-form__button link-button" to="/profile">
              Go to profile
            </Link>
          }
          body="You already have an active local account session in this browser."
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
          body="Create an account or log in before saving onboarding preferences."
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
        <div className="topbar-mark">
          <div className="mark-badge" aria-hidden="true">
            CS
          </div>
          <div>
            <p className="brand-kicker">ClosetSearch</p>
            <h1>Fashion resale discovery.</h1>
          </div>
        </div>
        <GlobalSearchBar />
        <div className="topbar-actions">
          <NavLink className="directory-link" to={brandDirectoryLink.path}>
            {brandDirectoryLink.label}
          </NavLink>
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

      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Visual resale discovery</p>
          <h2>Browse fashion resale like a feed, not a spreadsheet.</h2>
          <p>
            The API and web app keep discovery/search loosely coupled from account state, with a
            deterministic recommendation layer and lightweight in-memory storage instead of a
            database.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-chip">For You and Trending feed</div>
          <div className="hero-chip">Search brands, pieces, or styles</div>
          <div className="hero-chip">Likes, analytics, and trust placeholders</div>
        </div>
      </section>

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
