# Beta Feedback Plan

## Goal

Collect structured feedback that helps ClosetSearch become stable and honest enough for a wider launch without overreacting to one-off requests.

## Linked Intake Docs

- [Beta bug report template](./templates/beta-bug-report.md)
- [Beta feature request template](./templates/beta-feature-request.md)
- [Beta usability feedback template](./templates/beta-usability-feedback.md)
- [Beta triage rubric](./beta-triage-rubric.md)

## Target Beta Testers

- fashion enthusiasts who already browse multiple resale marketplaces
- archive or designer resale shoppers
- users comfortable comparing search, saved features, and price context across sources
- a small number of testers on desktop and mobile widths

## What Testers Should Try

- feed browsing signed out and signed in
- search with filters and sort modes
- brand browsing and brand-to-search handoff
- signup, login, logout, and session recovery
- likes, saved searches, saved filters, watchlists, and settings
- personalization behavior after liking or saving a few items
- analytics with both limited-data and observed-data states

## Feedback Questions

- What was confusing or hard to trust?
- Where did the app feel broken, slow, or inconsistent?
- Did saved features behave the way you expected?
- Did analytics copy feel honest and understandable?
- Did any route or flow feel too fragile for beta?
- What is the one thing that most improved or reduced confidence?

## Bug Report Template

- Environment:
- Signed in or signed out:
- Route or feature:
- Steps to reproduce:
- Expected behavior:
- Actual behavior:
- Screenshots or recordings:
- Severity:

## Feature Request Template

- Problem to solve:
- Current workaround:
- Proposed improvement:
- Why it matters for beta:
- Nice-to-have or launch-blocking:

## Severity Levels

- `P0`: launch-blocking, data loss, auth failure, or app unusable
- `P1`: major workflow broken, repeatable crash, or trust-damaging misleading behavior
- `P2`: frustrating but recoverable bug, missing polish, or inconsistent copy
- `P3`: minor polish or future improvement

## Triage Guidance

1. Confirm whether the report is reproducible.
2. Label whether it is product scope, bug, copy, provider reliability, or UX confusion.
3. Separate constrained-beta blockers from later public-launch work.
4. Prefer fixes that improve honesty, reliability, or saved-user trust over speculative feature growth.
5. If the issue is not being fixed now, record it in [post-beta priorities](./post-beta-priorities.md) or [known limitations](./known-limitations.md).

## Success Criteria for the Beta

- testers can complete feed, search, auth, saved-feature, analytics, and watchlist flows
- core routes avoid obvious crashes
- copy stays honest about analytics, trust signals, and inactive alert delivery
- the team gets actionable feedback instead of vague “it feels broken” reports

## Wider Launch Blockers

Do not widen the beta or move toward a public launch if any of these remain common:

- auth instability
- data corruption or saved-feature loss
- provider failures that regularly break feed or search
- misleading analytics or trust copy
- watchlist UI implying active alerts when no delivery exists
- deployment steps that are still unclear or fragile
