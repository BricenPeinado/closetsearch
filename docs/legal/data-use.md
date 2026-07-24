# ClosetSearch Beta Data-Use Copy

This is beta data-use copy for a constrained launch. It is operational guidance, not a lawyer-approved public policy.

## Account and Saved Feature Data

ClosetSearch uses stored account and saved-feature data to:

- keep users signed in with server-side sessions
- verify an email identity and support one-time account recovery/export actions
- persist likes, saved searches, saved filters, watchlists, notification preference shell data, and settings
- personalize the signed-in feed with explainable rules

Account-action tokens are stored only as purpose-bound hashes with short expiry.
Email, password-reset, and export messages are not sent unless a delivery
provider is explicitly configured. No breached-password network lookup is made
by default.

## Account Data Requests

The route-ready account lifecycle can produce a one-time JSON export of
user-owned data and can delete a confirmed account with its linked user-owned
records. It excludes credential and token hashes from exports. Marketplace
listing and price observations are retained because they are not attributed to
an individual user.

## Observed Listing Data

ClosetSearch uses observed listing and price snapshot data to:

- build cautious brand and category pricing ranges
- support observed under-market style analytics
- improve future debugging and product quality review

Observed listing data is not the same thing as complete marketplace coverage.

## Watchlists

Watchlists currently save what a user wants to track later.

They do not currently send:

- email
- push
- SMS

## Analytics Boundaries

ClosetSearch analytics in beta are:

- observed-data only
- not financial advice
- not price predictions
- not investment guidance

## Provider Data Limits

Provider data may be:

- incomplete
- delayed
- temporarily unavailable
- different from the live marketplace state by the time a user clicks through

## Feedback and Improvement

Beta feedback may be used to improve:

- product copy
- reliability
- saved-feature behavior
- personalization quality
- analytics clarity
- deployment and QA processes
