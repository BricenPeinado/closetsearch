# ClosetSearch

ClosetSearch is a fashion resale discovery platform that helps users search across clothing resale marketplaces, browse brands, and discover items through a personalized home feed.

The goal is to make secondhand fashion search feel fast, visual, and intelligent. Users should be able to:
- discover trending and relevant listings on the home feed
- search for specific items or brands across multiple resale sources
- filter listings by things like auction vs buy-now, price, brand, category, and more
- like pieces to improve future recommendations
- browse brands in a dedicated brand directory
- eventually access premium analytics and market insights

## Product Vision

ClosetSearch combines:
- multi-source resale search
- a visually rich infinite-scroll browsing experience
- recommendation systems based on popularity and user taste
- premium market analytics for fashion resale buyers and sellers

## Core User Experience

When a user opens the site, they land on a homepage showing a feed of listings. Each listing should display:
- item image
- title
- brand
- source marketplace
- price in the user's chosen currency

The home feed should support seamless infinite scrolling.

For signed-out users, the feed is driven by popularity, marketplace trends, and generalized relevance.

For signed-in users, the feed becomes more personalized over time based on:
- onboarding survey answers
- liked listings
- saved preferences
- engagement behavior

## Planned Navigation

Primary mobile-first navigation:
- Home
- Search
- Recent Searches
- Analytics
- Profile

Desktop layouts may adapt this navigation while keeping the same information architecture.

## Planned Feature Areas

### Discovery
- Trending home feed
- Personalized recommendations
- Infinite scroll feed
- Brand browsing

### Search
- Global search bar
- Filters for listing type, price, category, source, and sort order
- Recent searches
- Multi-marketplace search results

### Accounts
- Username/password signup
- Preference survey at onboarding
- Likes / hearts
- User profile

### Premium Analytics
- Market pricing insights
- Under-market listing detection
- Alerts for attractive listings
- Historical and predictive resale analytics

### Trust & Safety Intelligence
- Future AI-assisted fake-risk scoring using listing price, images, metadata, and market comparisons

## Initial Repository Goals

This repository is being structured for:
- clean architecture
- modular provider integrations
- small-pass AI-assisted development
- easy iteration with ChatGPT and Codex
- strong documentation and task tracking

## Repository Structure

```text
closetsearch/
  README.md
  PRODUCT.md
  ARCHITECTURE.md
  TASKS.md
  DECISIONS.md
  apps/
  packages/
  docs/
  tests/