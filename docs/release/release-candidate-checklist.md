# Release Candidate Checklist

Use this checklist before cutting or tagging a ClosetSearch launch candidate.

- [ ] `corepack pnpm install`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm lint`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm db:migrate`
- [ ] `corepack pnpm db:seed`
- [ ] `corepack pnpm smoke:test`
- [ ] API health check passes
- [ ] provider health check passes
- [ ] frontend shell loads
- [ ] signup, login, and logout work
- [ ] feed loads and load-more works
- [ ] search loads, filters work, and empty/error states render safely
- [ ] brand browsing loads and brand-to-search handoff works
- [ ] likes, saved searches, saved filters, watchlists, and settings persist
- [ ] personalization still works for signed-in and cold-start users
- [ ] analytics renders observed-data copy and disclaimers
- [ ] watchlist shell and notification-preference shell work
- [ ] mobile layout spot check completed
- [ ] privacy and data-use copy checked
- [ ] known limitations reviewed and current
- [ ] release notes prepared
- [ ] rollback plan reviewed
