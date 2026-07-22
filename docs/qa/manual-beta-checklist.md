# Manual Beta Checklist

Use this checklist before inviting or expanding constrained beta testers.

## 1. App Load

- Web app loads without a blank screen.
- `GET /health` returns `200`.
- Navigation works across Home, Search, Brands, Analytics, Profile, and Beta Information.

## 2. Feed

- Signed-out feed loads.
- Signed-in feed loads.
- Load more works.
- Feed empty state renders safely.
- Feed error state renders safely and offers retry.

## 3. Search

- Keyword search works.
- Source filter works.
- Listing type filter works.
- Price filters work.
- Sorting works.
- Empty search results render safely.
- Search error state renders safely and offers retry.
- Provider failure fallback does not crash the page.

## 4. Brands

- Brand directory loads.
- Brand search/filter works.
- Brand detail page loads.
- Brand-to-search handoff works.

## 5. Auth

- Signup works.
- Login works.
- Logout works.
- Expired or cleared session falls back to signed-out state.
- Protected routes reject signed-out users cleanly.

## 6. Saved User Features

- Likes persist after refresh.
- Saved searches persist.
- Saved filters persist.
- Profile loads saved data without crashing.
- Preferred currency and settings save.

## 7. Personalization

- Signed-in feed shows a personalization state or guidance.
- Liking items or setting preferences changes ranking enough to notice.
- A cold-start signed-in user still gets a usable feed.

## 8. Analytics

- Analytics page loads.
- Limited-data or locked state renders safely when applicable.
- Observed ranges show when data exists.
- Disclaimers appear.
- Copy does not claim predictions, profits, or guaranteed underpriced signals.

## 9. Watchlists

- Create a watched brand.
- Create a watched search.
- Create a watched price range.
- Edit a watchlist.
- Pause and resume a watchlist.
- Delete a watchlist.
- Save notification preference shell data.
- UI still says delivery is not active.

## 10. Mobile and Responsive

- Home, Search, Brands, Analytics, and Profile remain usable at mobile width.
- Listing cards stay readable.
- Search and profile forms remain usable.
- Bottom navigation stays functional.

## 11. Accessibility Basics

- Buttons have readable labels.
- Form fields have labels.
- Keyboard navigation works for major flows.
- Color contrast is acceptable enough for beta review.

## 12. Error and Edge Cases

- API offline state shows a safe error.
- Provider unavailable state degrades safely.
- Invalid form input shows structured errors.
- Expired session does not leave the UI stuck.
- Empty search results do not look broken.

## Sign-Off

- Record the environment used.
- Record whether seed/demo data was enabled.
- Record blockers separately from non-blocking polish items.
