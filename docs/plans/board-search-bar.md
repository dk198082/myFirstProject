# Board Job-Card Search Bar

## What & Why
Add a text search input directly below the Production Group pill-filter bar on the Schedule Board tab. Users need a quick way to find specific orders by number, item name, or resource without scrolling through every card in every group.

## Done looks like
- A search bar appears below the Production Group filter row on the Schedule Board tab (and only that tab).
- The bar has a magnifying-glass icon on the left and an × clear button that appears when text is entered (matching the style of the existing search bars in the app).
- Typing filters the visible job cards in real time — cards whose order number, item description, or production group name don't match the query are hidden.
- Group headers that have no visible cards after filtering are also hidden.
- The Unallocated section is filtered the same way.
- Clearing the search (or erasing all text) restores the full board instantly.
- Existing group-pill filter and search work together (both filters apply simultaneously).

## Out of scope
- Server-side search or API calls — client-side filter only.
- Searching across other tabs (Utilization, Picking, etc.).
- Persisting the search term across page reloads.

## Steps
1. **Add `boardSearch` state** — Add a `boardSearch` string state (default `""`) in the dashboard component alongside the existing filter group state.
2. **Render the search bar** — Place a search input (Search icon left, × clear button right, `bg-muted rounded-lg` styling) immediately below the Production Group pill row in the filter controls block.
3. **Filter job cards** — Derive a filtered view of the board data: when `boardSearch` is non-empty, keep only orders whose order number or item description contains the query (case-insensitive). Apply this on top of the existing group-pill filter.
4. **Hide empty groups** — When a group has zero visible cards after filtering, omit the group header and its card list from the rendered board (but keep the Unallocated group visible if it has matching cards).
5. **Filter Unallocated section** — Apply the same search filter to the Unallocated card list.

## Relevant files
- `artifacts/shop-floor/src/pages/dashboard.tsx:1106-1168`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1340-1430`
- `artifacts/shop-floor/src/pages/dashboard-hours-progress.test.tsx`
- `artifacts/shop-floor/src/pages/board-logic.test.tsx`
