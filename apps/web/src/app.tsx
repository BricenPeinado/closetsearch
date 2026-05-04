import type { ReactNode } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";

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

interface PageTemplateProps {
  eyebrow: string;
  title: string;
  description: string;
  highlightLabel: string;
  highlightValue: string;
  children?: ReactNode;
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

interface PlaceholderCardProps {
  title: string;
  detail: string;
  meta: string;
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
      eyebrow="Milestone 2"
      title="ClosetSearch app shell"
      description="The home feed is the core product surface, so this shell introduces the mood of ClosetSearch without pretending the real feed already exists."
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
            meta="Not implemented yet"
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
      description="Search is first-class and separate from feed logic. This page holds the spot for the future normalized search flow."
      highlightLabel="Planned surface"
      highlightValue="Query + filters + results"
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
      description="Authentication and personalization are out of scope for Milestone 2, so profile stays a simple shell with clear boundaries."
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
      description="The requested route does not exist in the Milestone 2 shell."
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
        <p>Each route stays intentionally honest about what Milestone 2 includes and what comes later.</p>
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

function SearchRoutePage() {
  return (
    <SearchPage>
      <PlaceholderStack
        cards={[
          {
            title: "Search input shell",
            detail:
              "A future query bar and route-level search controls will live here once the API search flow exists.",
            meta: "UI shell only",
          },
          {
            title: "Results area",
            detail:
              "Normalized listing results will eventually appear here with loading, empty, and error states.",
            meta: "No provider data yet",
          },
          {
            title: "Filter lane",
            detail:
              "Brands, sizes, condition, and price filters can be introduced once the shared search contract is ready.",
            meta: "Later milestone",
          },
        ]}
      />
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
              "Access rules, subscriptions, and premium unlocks are intentionally not part of Milestone 2.",
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
              "Later versions may connect this page to brand preferences, likes, and feed tuning without mixing that into Milestone 2.",
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
          <p className="eyebrow">Milestone 2 shell</p>
          <h2>Mobile-first structure for browsing, searching, and brand discovery.</h2>
          <p>
            This app shell focuses on navigation, placeholder surfaces, and
            clean boundaries. Real listings, provider data, auth, and analytics
            logic come later.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-chip">Visual-first feed direction</div>
          <div className="hero-chip">Search remains first-class</div>
          <div className="hero-chip">Brand browsing stays core</div>
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
          <Route
            element={<RecentSearchesRoutePage />}
            path="/recent-searches"
          />
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
