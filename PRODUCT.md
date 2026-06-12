# Product

## Product Summary

ClosetSearch is a fashion resale discovery app that aggregates resale listings into a visual browsing and search experience.

The product should help users:

- discover interesting listings without checking many marketplaces manually
- search for specific brands, pieces, sizes, and price ranges
- browse brands through a dedicated directory
- save listings and searches that matter to them
- gradually benefit from personalization and pricing context once the core product is reliable

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
- users who want watchlists, alerts, or pricing context

## Product Principles

- Visual first: the product should feel like a resale marketplace browser, not a dashboard.
- Fast discovery: users should reach interesting listings quickly.
- Search quality matters: search is a core workflow, not a secondary utility.
- Provider neutrality: provider-specific complexity should stay out of the user experience.
- Responsible intelligence: analytics and trust signals should start simple and cautious.
- Honest scope: the product should be explicit about what is real, mock, or placeholder.

## Current Foundation

The current codebase already includes a meaningful foundation:

- home feed
- listing cards
- search with filters and sorting
- recent searches
- brand directory and brand detail shell
- signup, login, onboarding, profile, and likes foundations
- simple personalization rules based on likes and onboarding preferences
- premium analytics placeholder surfaces
- trust / fake-risk placeholder signals with assistive wording

Important current limits:

- listing data is still mock-backed
- provider integrations are not real yet
- auth and persistence are still lightweight foundations
- analytics are not real market intelligence yet
- fake-risk is not real authenticity detection

## V1 Functional Target

The next real product target is a beta-ready functional resale app with:

- real provider-backed search
- real provider-backed feed
- stable account system
- persistent likes and onboarding preferences
- saved searches and watchlists
- improved personalization from real engagement data
- real but simple analytics signals based on observed pricing data
- clean marketplace UI across mobile and desktop
- beta-ready deployment and operational basics

V1 should feel useful and honest, not overbuilt.

### Feed

The feed should remain the core surface.

V1 feed expectations:

- real listings from at least one provider
- responsive visual grid
- real pagination or infinite-scroll friendly behavior
- deduped results when paging or combining providers
- good loading, empty, and error states
- signed-out discovery plus signed-in personalization fallback

### Search

Search should be first-class and reliable.

V1 search expectations:

- text query support
- useful filters and sort options
- normalized results from real providers
- stable pagination
- recent searches and saved searches
- graceful handling of missing or partial source data

### Brands

Brand browsing should stay part of the core product.

V1 brand expectations:

- searchable brand directory
- alias and tag support where useful
- quick handoff into real search results
- room for richer brand-specific discovery later

### Accounts and Saved User Features

The current auth and profile surfaces are a foundation only.

V1 account expectations:

- safer auth flow
- persistent user record
- persistent likes
- persistent onboarding preferences
- saved searches and watchlists
- useful profile/settings shell

### Personalization

Personalization should improve after real engagement data exists.

V1 personalization expectations:

- use likes and onboarding preferences
- improve brand and category weighting
- reduce repetitive feed results
- keep ranking logic explainable
- preserve a discovery fallback for sparse-user scenarios

### Analytics

Analytics should begin as simple pricing context, not advanced prediction.

V1 analytics expectations:

- observed price snapshots
- simple brand/category pricing ranges
- under-market style signals based on observed data
- clear disclaimers and limited claims
- no forecasting or unsupported market certainty language

### Trust / Fake-Risk

Trust/fake-risk should remain carefully limited.

V1 trust expectations:

- optional assistive signals only
- careful labels and disclaimers
- no fake/authentic certainty claims
- no blocking or filtering based on trust signals
- no ML or speculative authenticity logic

## Later Phases

Later phases can expand once V1 discovery and reliability are strong:

- multiple real providers
- richer saved-item workflows
- broader alert delivery
- stronger analytics depth over time
- more advanced personalization controls
- premium feature packaging when the underlying data is trustworthy

## Non-Goals for the Current and Near-Term Build

Do not overclaim or overbuild these before the core product is ready:

- full production-scale provider network
- advanced forecasting analytics
- binary authenticity verdicts
- AI/ML fake detection
- payment processing
- seller tooling
- marketplace posting
- social messaging systems
- complex admin systems

## Product Success Criteria

The current foundation is successful when:

- the app surfaces work together cleanly
- docs and milestones stay honest
- real provider work can be added without rewriting the product model

The next functional V1 is successful when:

- users can browse and search real provider-backed listings
- key user state persists reliably
- personalization and analytics provide lightweight value without overclaiming
- the app is stable enough for a limited beta
