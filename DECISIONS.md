# Decisions

This file records durable product and architecture decisions. Keep entries short, dated, and easy to revisit.

## Template

### Decision Title

**Date:** YYYY-MM-DD  
**Status:** Proposed | Accepted | Superseded

#### Context

What problem or tradeoff prompted this decision?

#### Decision

What was chosen?

#### Alternatives Considered

What other options were considered?

#### Consequences

What becomes easier, harder, or intentionally deferred?

## Accepted Decisions

### Product Scope Is Phased

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

The product vision includes feed discovery, search, brand browsing, personalization, premium analytics, and fake-risk intelligence. Building all of that at once would blur priorities and make early implementation hard to review.

#### Decision

The initial build will focus on the core discovery/search experience:

- home feed
- search
- brand browsing
- normalized listing cards
- modular provider foundations

Accounts, likes, personalization, premium analytics, and fake-risk intelligence are planned later.

#### Alternatives Considered

- Build accounts and personalization in V1.
- Build premium analytics early.
- Delay documenting future systems entirely.

#### Consequences

The first implementation passes stay focused and reviewable while the docs still preserve the long-term product direction.

### The Home Feed Is the Core Surface

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

ClosetSearch should feel like a visual resale discovery product, not only a utility search box.

#### Decision

The home feed is the primary product surface. It should become a fast, visual, scrollable listing experience.

#### Alternatives Considered

- Prioritize search-only workflows first.
- Treat the homepage as a static landing page.

#### Consequences

Feed quality, listing card design, loading states, pagination, and ranking strategy are top-level product concerns.

### Search Is First-Class and Separate From Feed Logic

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Feed discovery and intentional search have different user intent, ranking needs, and product behavior.

#### Decision

Search will be implemented as a first-class workflow separate from feed logic, while sharing normalized listing models where appropriate.

#### Alternatives Considered

- Use feed logic for all listing retrieval.
- Treat search as a thin UI filter over the feed.

#### Consequences

Search can support explicit queries, filters, sorting, and provider orchestration without distorting the home feed.

### Provider Integrations Must Be Modular and Normalized

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Resale marketplaces have different APIs, data shapes, reliability patterns, and listing semantics.

#### Decision

All marketplace integrations must sit behind provider contracts and normalize results into shared ClosetSearch domain models.

#### Alternatives Considered

- Let marketplace-specific response shapes leak into the API or UI.
- Build provider-specific UI paths.

#### Consequences

Provider work can grow incrementally, and the rest of the app can remain stable as providers are added or replaced.

### Premium Analytics Is Deferred Until Core Discovery Works

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Premium analytics may become valuable, but it depends on reliable listing data, search quality, and user trust.

#### Decision

Premium analytics will be planned in docs but not implemented in the initial build.

#### Alternatives Considered

- Add a premium analytics shell in the first app skeleton.
- Ignore analytics until much later.

#### Consequences

The repo avoids weak monetization scaffolding while preserving a clear future direction.

### Fake-Risk Intelligence Must Be Assistive, Not Definitive

**Date:** 2026-04-23  
**Status:** Accepted

#### Context

Authenticity and fake-risk signals are sensitive. Overconfident product language could mislead users.

#### Decision

Any future fake-risk feature must be framed as an assistive risk signal, not a definitive authenticity judgment.

#### Alternatives Considered

- Present binary fake/authentic labels.
- Avoid defining trust language until implementation.

#### Consequences

Future trust work has a safer product boundary, but no fake-risk scoring or UI should be built before the core product is stable.
