# Product

## Product Summary

ClosetSearch is a fashion resale discovery platform that aggregates clothing resale listings and presents them through a fast, visual browsing and search experience.

The product should help users:

- discover interesting resale listings without checking many marketplaces manually
- search for specific items, brands, sizes, or categories
- browse brands through a dedicated brand experience
- eventually use personalization and market intelligence once the core product is strong

## Target Users

Primary users:

- fashion enthusiasts
- archive fashion buyers
- streetwear buyers
- designer resale shoppers
- people who regularly browse multiple resale marketplaces

Later power users:

- resellers
- collectors
- market-focused buyers
- users looking for pricing signals, alerts, or deeper resale insights

## Product Principles

- Visual first: listing cards should make resale browsing feel immediate and compelling.
- Fast discovery: users should reach relevant listings quickly.
- Search quality matters: search is a core workflow, not a secondary feature.
- Provider neutrality: the product should not expose marketplace-specific complexity to users.
- Phased intelligence: personalization, analytics, and fake-risk signals should arrive only after the core feed/search product is useful.
- Responsible language: pricing and authenticity signals must be framed carefully when introduced.

## Core Surfaces

### Home Feed

The home feed is the core product surface. It should eventually show an infinite, visual feed of resale listings.

Each listing card should show:

- image
- title
- brand
- source marketplace
- price and currency

Initial feed logic should stay simple and signed-out. Personalization can be added later after accounts and engagement data exist.

### Search

Search is first-class and separate from feed logic.

Search should eventually support:

- text queries
- brand filters
- category filters
- size filters
- condition filters
- price filters
- marketplace/source filters
- listing type filters
- sorting

The first implementation should prove the normalized search flow before adding every filter.

### Brand Browsing

Brand browsing is part of the core product. The first version can use a simple brand directory and connect brands to search flows later.

### Future Personalization

Personalization is part of the long-term direction, but not the first implementation target. Accounts, onboarding, likes, and engagement-based recommendations should wait until the core feed/search experience works.

### Future Premium Analytics

Premium analytics is planned for later phases. Possible future capabilities include market pricing summaries, underpriced listing signals, historical context, and alerts.

These features should not be built until the core discovery/search experience has enough data quality and user value.

### Future Fake-Risk Intelligence

Fake-risk intelligence is a future trust feature. It may use listing metadata, price anomalies, image signals, and source confidence.

It must be presented as an assistive risk signal, not a definitive authenticity claim.

## V1 Scope

V1 should focus on the core discovery/search product:

- home feed surface
- listing card model and presentation
- global search surface
- basic normalized search query support
- basic filters needed for useful browsing
- brand directory / brand browsing
- modular provider contract
- at least one provider flow, which can begin as mock data before a real integration
- loading, empty, and error states for feed/search

## Later Phases

### Accounts and Personalization

- signup and login
- onboarding preferences
- likes/hearts
- recent searches tied to a user
- profile surface
- signed-in personalized feed

### Premium Analytics

- analytics surface
- premium access rules
- market pricing summaries
- underpriced listing signals
- alerts or watchlists
- historical pricing context

### Trust and Fake-Risk

- safe product language for authenticity risk
- risk-signal model
- source confidence and anomaly indicators
- image, price, and metadata signal exploration

## Non-Goals for the Initial Build

Do not build these before the core discovery/search experience is established:

- authentication
- user profiles
- likes/favorites
- saved searches
- payments or subscriptions
- premium analytics
- alerts
- advanced recommendation systems
- fake detection or fake-risk scoring
- seller tools
- marketplace posting
- social features or messaging
- complex admin systems

## Success Criteria for Foundation

The product foundation is ready when:

- V1 scope is clear enough to implement in small passes
- feed and search responsibilities are separated
- provider normalization is required by design
- premium analytics and fake-risk work are explicitly deferred
- engineering tasks can be reviewed milestone by milestone
