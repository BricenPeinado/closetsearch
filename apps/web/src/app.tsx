import { startTransition, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { FeedResponse, Listing, SearchResponse, SearchSortMode } from "@closetsearch/shared";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
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

const primaryNavigationItems = [
  { label: "Home", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Recent Searches", path: "/recent-searches" },
  { label: "Analytics", path: "/analytics" },
  { label: "Profile", path: "/profile" },
] as const;

const brandDirectoryLink = {
  label: "Brand Directory",
  path: "/brands",
} as const;

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
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

interface PlaceholderCardProps {
  title: string;
  detail: string;
  meta: string;
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

function PlaceholderCard({ title, detail, meta }: PlaceholderCardProps) {
  return (
    <article className="placeholder-card">
      <h2>{title}</h2>
      <p>{detail}</p>
      <span>{meta}</span>
    </article>
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

function ListingGrid({ listings }: { listings: Listing[] }) {
  return (
    <div className="listing-grid">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;

    throw new Error(errorBody?.message ?? "The request could not be completed.");
  }

  return (await response.json()) as T;
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
        Search across ClosetSearch
      </label>
      <div className="global-search__controls">
        <input
          className="global-search__input"
          id="global-search-input"
          name="q"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search jackets, brands, or materials"
          value={query}
        />
        <button className="global-search__button" type="submit">
          Search
        </button>
      </div>
    </form>
  );
}

function HomePage() {
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<FeedRequestState>({
    hasMore: false,
    isLoadingMore: false,
    listings: [],
    status: "loading",
    total: 0,
  });

  useEffect(() => {
    const controller = new AbortController();

    setState({
      hasMore: false,
      isLoadingMore: false,
      listings: [],
      status: "loading",
      total: 0,
    });

    void fetchJson<FeedResponse>(
      `/feed?page=1&pageSize=${homeFeedPageSize}`,
      controller.signal,
    )
      .then((response) => {
        setState({
          hasMore: response.hasMore,
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
          isLoadingMore: false,
          listings: [],
          status: "error",
          total: 0,
        });
      });

    return () => {
      controller.abort();
    };
  }, [reloadCount]);

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

    void fetchJson<FeedResponse>(
      `/feed?page=${state.nextPage}&pageSize=${homeFeedPageSize}`,
    )
      .then((response) => {
        setState((currentState) => ({
          ...currentState,
          hasMore: response.hasMore,
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

  let feedContent: ReactNode;

  if (state.status === "loading") {
    feedContent = (
      <StateCard
        body="Pulling the first page of normalized listings from the signed-out feed."
        title="Loading feed"
      />
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
      <StateCard
        body="The signed-out discovery feed does not have any listings to show yet."
        title="Nothing in the feed yet"
      />
    );
  } else {
    feedContent = (
      <section className="feed-results">
        <div className="section-heading">
          <h2>{state.total} normalized listings in the feed</h2>
          <p>Signed-out discovery is using the mock provider today, with simple page-based pagination.</p>
        </div>
        <ListingGrid listings={state.listings} />
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
      eyebrow="Milestone 4"
      title="Homepage Feed"
      description="The home surface still fetches normalized listings from a dedicated feed endpoint while the new search experience lives in its own API and UI path."
      highlightLabel="Current behavior"
      highlightValue="Signed-out feed with load more"
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
      description="Use a single normalized search flow for keyword, marketplace, listing type, price range, and sorting without exposing provider-specific response data."
      highlightLabel="Active flow"
      highlightValue="Global search + filters + local history"
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
      description="Recent searches are stored only in browser localStorage for now, with no account or database persistence mixed into the search milestone."
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
      eyebrow="Deferred"
      title="Analytics"
      description="Premium analytics is intentionally deferred. This placeholder keeps the planned surface visible without inventing monetization or insight logic too early."
      highlightLabel="Status"
      highlightValue="Future premium system"
    >
      {children}
    </PageTemplate>
  );
}

function ProfilePage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Deferred"
      title="Profile"
      description="Authentication and personalization remain out of scope, so profile stays a simple shell with clear boundaries."
      highlightLabel="Blocked by"
      highlightValue="Auth foundation"
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
      description="Brand browsing is part of the core product. This shell reserves space for a browsable brand index and future search handoff."
      highlightLabel="Planned surface"
      highlightValue="Directory + brand discovery"
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

function PlaceholderStack({ cards }: { cards: PlaceholderCardProps[] }) {
  return (
    <section className="placeholder-section">
      <div className="section-heading">
        <h2>What this page will become</h2>
        <p>Each route stays intentionally honest about what this milestone includes and what comes later.</p>
      </div>
      <div className="placeholder-grid">
        {cards.map((card) => (
          <PlaceholderCard
            key={card.title}
            detail={card.detail}
            meta={card.meta}
            title={card.title}
          />
        ))}
      </div>
    </section>
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
  query,
  state,
  summary,
  onRetry,
}: {
  query: string;
  state: SearchRequestState;
  summary: string;
  onRetry: () => void;
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

      <ListingGrid listings={response.listings} />
    </section>
  );
}

function SearchRoutePage() {
  const navigate = useNavigate();
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

  return (
    <SearchPage>
      <section className="search-layout">
        <SearchControlPanel initialValues={values} onSubmit={handleSubmit} />
        <SearchResults
          onRetry={handleRetry}
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

function AnalyticsRoutePage() {
  return (
    <AnalyticsPage>
      <PlaceholderStack
        cards={[
          {
            title: "Market summaries",
            detail:
              "Any pricing context or trend insights belong here later, after core discovery and data quality are stable.",
            meta: "Explicitly deferred",
          },
          {
            title: "Premium gating",
            detail:
              "Access rules, subscriptions, and premium unlocks are intentionally not part of this milestone.",
            meta: "Out of scope",
          },
        ]}
      />
    </AnalyticsPage>
  );
}

function ProfileRoutePage() {
  return (
    <ProfilePage>
      <PlaceholderStack
        cards={[
          {
            title: "Identity",
            detail:
              "Profile details, onboarding preferences, and session controls will wait until auth exists.",
            meta: "Out of scope",
          },
          {
            title: "Preference hub",
            detail:
              "Later versions may connect this page to brand preferences, likes, and feed tuning without mixing that into this milestone.",
            meta: "Future foundation",
          },
        ]}
      />
    </ProfilePage>
  );
}

function BrandsRoutePage() {
  return (
    <BrandsPage>
      <PlaceholderStack
        cards={[
          {
            title: "A-Z directory",
            detail:
              "The first real brand experience can start as a simple searchable list before deeper brand pages exist.",
            meta: "Planned core surface",
          },
          {
            title: "Search handoff",
            detail:
              "Selecting a brand should eventually launch a matching search flow without leaking provider-specific details.",
            meta: "Later milestone",
          },
          {
            title: "Brand notes",
            detail:
              "Aliases, brand metadata, and curation can be added only when the directory needs them.",
            meta: "Do not overbuild",
          },
        ]}
      />
    </BrandsPage>
  );
}

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-mark">
          <div className="mark-badge" aria-hidden="true">
            CS
          </div>
          <div>
            <p className="brand-kicker">ClosetSearch</p>
            <h1>Search experience foundation.</h1>
          </div>
        </div>
        <GlobalSearchBar />
        <NavLink className="directory-link" to={brandDirectoryLink.path}>
          {brandDirectoryLink.label}
        </NavLink>
      </header>

      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Milestone 5 foundation</p>
          <h2>Search is now a real product surface with global entry, filters, and local memory.</h2>
          <p>
            Home and search still share the same listing card while the API keeps feed and search as
            separate normalized flows.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-chip">Global top search bar</div>
          <div className="hero-chip">Normalized filters and sorting</div>
          <div className="hero-chip">Browser-only recent searches</div>
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
          <Route element={<HomePage />} path="/" />
          <Route element={<SearchRoutePage />} path="/search" />
          <Route element={<RecentSearchesRoutePage />} path="/recent-searches" />
          <Route element={<AnalyticsRoutePage />} path="/analytics" />
          <Route element={<ProfileRoutePage />} path="/profile" />
          <Route element={<BrandsRoutePage />} path="/brands" />
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
