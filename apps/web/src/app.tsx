import { startTransition, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { FeedResponse, Listing, SearchResponse } from "@closetsearch/shared";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ListingCard } from "./components/listing-card";

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
      description="The home surface now fetches normalized listings from a dedicated feed endpoint and renders them in the same reusable card UI as search."
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
      eyebrow="Search"
      title="Search"
      description="Search is first-class and separate from feed logic. This page continues to exercise the normalized API search flow through the mock provider foundation."
      highlightLabel="Active flow"
      highlightValue="Query -> API -> normalized listings"
    >
      {children}
    </PageTemplate>
  );
}

function RecentSearchesPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Recent searches"
      title="Recent Searches"
      description="This page keeps the eventual search memory surface visible without implementing saved or account-backed history yet."
      highlightLabel="Deferred dependency"
      highlightValue="Signed-in history"
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

function SearchForm({ initialQuery }: { initialQuery: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextQuery = query.trim();

    startTransition(() => {
      navigate(nextQuery.length > 0 ? `/search?q=${encodeURIComponent(nextQuery)}` : "/search");
    });
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <label className="search-form__label" htmlFor="search-query">
        Search listings
      </label>
      <div className="search-form__controls">
        <input
          className="search-form__input"
          id="search-query"
          name="q"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try jacket, trousers, or a brand name"
          value={query}
        />
        <button className="search-form__button" type="submit">
          Search
        </button>
      </div>
    </form>
  );
}

function SearchResults({ state, query }: { state: SearchRequestState; query: string }) {
  if (state.status === "idle") {
    return (
      <StateCard
        body="Try a product type, brand, or material to pull normalized listings from the API."
        title="Start with a search"
      />
    );
  }

  if (state.status === "loading") {
    return (
      <StateCard
        body="Fetching normalized listings from the server-side mock provider flow."
        title={`Searching for "${query}"`}
      />
    );
  }

  if (state.status === "error") {
    return (
      <StateCard
        body={state.errorMessage ?? "The search request could not be completed."}
        title="Search unavailable"
      />
    );
  }

  const response = state.response;

  if (!response || response.listings.length === 0) {
    return (
      <StateCard body="Try a broader query or a different brand name." title="No listings found" />
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
      <ListingGrid listings={response.listings} />
    </section>
  );
}

function SearchRoutePage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const [state, setState] = useState<SearchRequestState>({
    status: query.length > 0 ? "loading" : "idle",
  });

  useEffect(() => {
    if (query.length === 0) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();

    setState({ status: "loading" });

    void fetchJson<SearchResponse>(`/search?q=${encodeURIComponent(query)}`, controller.signal)
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
  }, [query]);

  return (
    <SearchPage>
      <section className="search-surface">
        <SearchForm initialQuery={query} />
        <SearchResults query={query} state={state} />
      </section>
    </SearchPage>
  );
}

function RecentSearchesRoutePage() {
  return (
    <RecentSearchesPage>
      <PlaceholderStack
        cards={[
          {
            title: "Recent query list",
            detail:
              "This area will eventually help users jump back into previous searches once account or local-history choices are made.",
            meta: "Not implemented yet",
          },
          {
            title: "Quick restart",
            detail:
              "Future recent-search cards can deep-link into the search page with carried-over query state.",
            meta: "Planned handoff",
          },
        ]}
      />
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
            <h1>The beginning of resale discovery.</h1>
          </div>
        </div>
        <NavLink className="directory-link" to={brandDirectoryLink.path}>
          {brandDirectoryLink.label}
        </NavLink>
      </header>

      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Milestone 4 foundation</p>
          <h2>Signed-out discovery feed on top, normalized search path still intact underneath.</h2>
          <p>
            Home and search now share the same listing card while the API keeps feed and search as
            separate normalized flows.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-chip">Visual-first feed direction</div>
          <div className="hero-chip">Search remains first-class</div>
          <div className="hero-chip">Provider data stays normalized</div>
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
