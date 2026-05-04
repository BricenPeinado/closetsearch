import { startTransition, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Listing, SearchResponse } from "@closetsearch/shared";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

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

interface PageTemplateProps {
  eyebrow: string;
  title: string;
  description: string;
  highlightLabel: string;
  highlightValue: string;
  children?: ReactNode;
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

function formatPrice(listing: Listing) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.price.currency,
    maximumFractionDigits: 0,
  }).format(listing.price.amount);
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

function HomePage() {
  return (
    <PageTemplate
      eyebrow="Milestone 3"
      title="ClosetSearch app shell"
      description="The home feed is still intentionally deferred, but the shared listing model and provider-backed search path are now in place underneath the product shell."
      highlightLabel="Next up"
      highlightValue="Signed-out discovery feed"
    >
      <section className="placeholder-section">
        <div className="section-heading">
          <h2>What this page will become</h2>
          <p>A visual discovery feed with consistent listing cards and calm empty states.</p>
        </div>
        <div className="placeholder-grid">
          <PlaceholderCard
            title="Feed cards"
            detail="A scrollable lineup of normalized resale listings with image, title, brand, source, and price."
            meta="Still next milestone"
          />
          <PlaceholderCard
            title="Loading state"
            detail="A polished feed skeleton so the app still feels alive while data arrives from the API boundary."
            meta="Placeholder pattern"
          />
          <PlaceholderCard
            title="Empty state"
            detail="Friendly guidance for moments when discovery has nothing useful to show yet."
            meta="Placeholder pattern"
          />
        </div>
      </section>
    </PageTemplate>
  );
}

function SearchPage({ children }: { children?: ReactNode }) {
  return (
    <PageTemplate
      eyebrow="Search"
      title="Search"
      description="Search is first-class and separate from feed logic. This page now exercises the normalized API search flow through the mock provider foundation."
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

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="listing-card">
      <div className="listing-card__image-wrap">
        <img
          alt={listing.title}
          className="listing-card__image"
          loading="lazy"
          src={listing.imageUrl}
        />
      </div>
      <div className="listing-card__body">
        <div className="listing-card__topline">
          <p>{listing.brand.name}</p>
          <span>{listing.source.name}</span>
        </div>
        <h2>{listing.title}</h2>
        <p className="listing-card__meta">
          {[listing.category, listing.size, listing.condition].filter(Boolean).join(" • ")}
        </p>
        <div className="listing-card__footer">
          <strong>{formatPrice(listing)}</strong>
          <a href={listing.sourceUrl} rel="noreferrer" target="_blank">
            View listing
          </a>
        </div>
      </div>
    </article>
  );
}

function SearchResults({ state, query }: { state: SearchRequestState; query: string }) {
  if (state.status === "idle") {
    return (
      <section className="search-state-card">
        <h2>Start with a search</h2>
        <p>Try a product type, brand, or material to pull normalized listings from the API.</p>
      </section>
    );
  }

  if (state.status === "loading") {
    return (
      <section className="search-state-card">
        <h2>Searching for “{query}”</h2>
        <p>Fetching normalized listings from the server-side mock provider flow.</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="search-state-card">
        <h2>Search unavailable</h2>
        <p>{state.errorMessage ?? "The search request could not be completed."}</p>
      </section>
    );
  }

  const response = state.response;

  if (!response || response.listings.length === 0) {
    return (
      <section className="search-state-card">
        <h2>No listings found</h2>
        <p>Try a broader query or a different brand name.</p>
      </section>
    );
  }

  return (
    <section className="search-results">
      <div className="section-heading">
        <h2>{response.total} normalized listings</h2>
        <p>
          Results for “{response.query.text}” from{" "}
          {response.providers.map((provider) => provider.providerName).join(", ")}.
        </p>
      </div>
      <div className="listing-grid">
        {response.listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
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

    void fetch(`${apiBaseUrl}/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;

          throw new Error(errorBody?.message ?? "Search request failed.");
        }

        return (await response.json()) as SearchResponse;
      })
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
          <p className="eyebrow">Milestone 3 foundation</p>
          <h2>Mobile-first structure with a real normalized search path underneath it.</h2>
          <p>
            The UI still keeps deferred systems out of the way, but search now calls the API
            boundary and renders normalized listing cards from the mock provider.
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
