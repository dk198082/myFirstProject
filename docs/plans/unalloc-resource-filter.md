# Resource Filter on Unallocated Section

## What & Why
The Unallocated section already has a Pool pill filter that lets managers narrow the board to a specific production pool. Managers also want to filter by resource code (work centre) so they can see only the orders assigned to a particular resource within that section. The Resource filter should sit directly below the Pool filter and behave identically — dynamic pills, multi-select toggle, independent Clear button.

## Done looks like
- A "Resource:" pill bar appears below the Pool filter bar whenever any unallocated order has a non-null resource code
- Pills are derived only from the current unallocated order list (same as Pool), sorted alphabetically
- Clicking a pill toggles it; multiple pills can be active simultaneously (OR within Resource, AND between Pool and Resource)
- A "Clear" button appears beside the Resource pills when at least one is active, clears only the Resource filter
- The existing Pool filter continues to work independently; both filters combine (an order must match both)
- The empty-state message updates to mention "pool or resource filter" when either filter is active
- No test regressions

## Out of scope
- Persisting the Resource filter across sessions
- Filtering by resource in the grid/detail view that opens from "View production order data"

## Steps
1. **Derive resource list** — add a `unallocResources` memo that collects unique non-null/non-empty `resourcecode` values from `unallocatedOrders`, sorted alphabetically. Mirror the existing `unallocPools` memo exactly.
2. **Resource filter state** — add a `unallocResourceFilter` `useState<Set<string>>(new Set())`. Update the `filteredUnallocatedOrders` memo to apply both pool and resource filters (pool AND resource must both match).
3. **Resource pill bar UI** — below the Pool filter `<div>`, add an identical pill bar guarded by `unallocResources.length > 0`, labelled "Resource:" with the same pill styling and a Clear button.
4. **Empty-state copy** — update the empty-state message so it says "No orders match the selected pool or resource filter" when either filter has selections.

## Relevant files
- `artifacts/shop-floor/src/pages/dashboard.tsx:742-748,941-996,1503-1550`
